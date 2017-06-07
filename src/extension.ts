'use strict';

import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import * as fs from 'fs';
import * as tmp from 'tmp';

import * as path from './path';
import * as batch from './batch';

var output : vscode.OutputChannel = vscode.window.createOutputChannel('Azure Batch');

export function activate(context: vscode.ExtensionContext) {

    let disposables = [
        vscode.commands.registerCommand('azure.batch.createJob', createJob),
        vscode.commands.registerCommand('azure.batch.createPool', createPool)
    ];

    disposables.forEach((d) => context.subscriptions.push(d), this);
}

export function deactivate() {
}

function withActiveDocument(action: (doc : vscode.TextDocument) => void) {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    const doc = activeEditor.document;
    if (!doc) {
        return;
    }

    action(doc);
}

function createJob() {
    withActiveDocument((doc) => createResourceImpl(doc, 'job'));
}

function createPool() {
    withActiveDocument((doc) => createResourceImpl(doc, 'pool'));
}

async function createResourceImpl(doc : vscode.TextDocument, resourceType : batch.BatchResourceType) {

    const templateInfo = batch.parseBatchTemplate(doc.getText(), resourceType);
    if (!templateInfo) {
        await vscode.window.showErrorMessage(`Current file is not an Azure Batch ${resourceType} template.`);  // TODO: support job JSON
        return;
    }

    const templateFileName = doc.fileName;  // TODO: handle the case where the doc has never been saved

    if (doc.isDirty) {
        await doc.save();
    }

    // TODO: this results in the unnecessary creation and deletion of a temp file in
    // the non-template case - it is harmless and simplifies the code, but it would be
    // nice not to have to do it!
    const parameterFile = await getParameterFile(templateFileName, resourceType);

    const knownParametersText = getParameterJson(parameterFile);
    const knownParameters = batch.parseParameters(knownParametersText);
    const isKnownParameter = (n : string) => knownParameters.findIndex((p) => p.name == n) >= 0;
    const anyUnknownParameters = templateInfo.parameters.findIndex((p) => !isKnownParameter(p.name)) >= 0;

    const tempParameterInfo = anyUnknownParameters ? await createTempParameterFile(templateInfo, knownParameters) : undefined;

    if (tempParameterInfo && tempParameterInfo.abandoned) {
        return;
    }

    const parameterFilePath = tempParameterInfo ? tempParameterInfo.path : parameterFile.path;

    const cleanup = tempParameterInfo ? () => { fs.unlinkSync(tempParameterInfo.path); } : () => { return; };
    const commandOptions = templateInfo.isTemplate ?
        `--template "${doc.fileName}" --parameters "${parameterFilePath}"` :
        `--json-file "${doc.fileName}"`;

    output.show();
    output.appendLine(`Creating Azure Batch ${resourceType}...`);

    shelljs.exec(`az batch ${resourceType} create ${commandOptions}`, { async: true }, (code : number, stdout : string, stderr : string) => {
        cleanup();

        if (code !== 0 || stderr) {  // TODO: figure out what to check (if anything) - problem is that the CLI can return exit code 0 on failure... but it writes to stderr on success too (the experimental feature warnings)
            output.appendLine(stderr);
        } else {
            output.appendLine(stdout);
        }

        output.appendLine("Done");
    });

}

async function getParameterFile(templateFileName : string, resourceType : batch.BatchResourceType) : Promise<IParameterFileInfo> {
    const templateFileRoot = path.stripExtension(templateFileName);
    const templateFileDir = path.directory(templateFileName);

    const parameterFileNames = [
        templateFileRoot + '.parameters.json',
        templateFileDir + `/${resourceType}parameters.json`,
        templateFileDir + `/parameters.${resourceType}.json`,
        templateFileDir + '/parameters.json'
    ];
    const parameterFileName = parameterFileNames.find(s => fs.existsSync(s));

    if (!parameterFileName) {
        return {
            exists: false,
            path: ''
        };
    }

    const parametersDoc = vscode.workspace.textDocuments.find((d) => path.equal(d.fileName, parameterFileName));
    if (parametersDoc && parametersDoc.isDirty) {
        await parametersDoc.save();
    }

    return {
        exists: true,
        path: parameterFileName,
        document: parametersDoc
    };
}

function getParameterJson(parameterFile : IParameterFileInfo) : string {
    if (parameterFile.exists) {
        return parameterFile.document ? parameterFile.document.getText() : fs.readFileSync(parameterFile.path, 'utf8');
    }
    return '{}';
}

async function createTempParameterFile(jobTemplateInfo : batch.IBatchResource, knownParameters : batch.IParameterValue[]) : Promise<ITempFileInfo | undefined> {
    let parameterObject : any = {};
    for (const p of jobTemplateInfo.parameters) {
        const known = knownParameters.find((pv) => pv.name == p.name);
        const value = known ? known.value : await promptForParameterValue(p);
        if (value) {
            parameterObject[p.name] = value;
        } else {
            return { abandoned: true, path: '' };
        }
    }

    const json = JSON.stringify(parameterObject);

    const tempFile = tmp.fileSync();
    
    fs.writeFileSync(tempFile.name, json, { encoding: 'utf8' });

    return { abandoned: false, path: tempFile.name };
}

async function promptForParameterValue(parameter : batch.IBatchTemplateParameter) : Promise<any> {
    let description = '';
    if (parameter.metadata) {
        description = ` | ${parameter.metadata.description}`;
    }

    if (parameter.allowedValues) {
        const allowedValueQuickPicks = parameter.allowedValues.map((v) => quickPickFor(v));
        const opts = { placeHolder: `${parameter.name}${description}` };
        const selectedValue = await vscode.window.showQuickPick(allowedValueQuickPicks, opts);
        return selectedValue ? selectedValue.value : undefined;
    } else {
        const opts = {
            prompt: `${parameter.name}${description} (${parameter.dataType})`,
            value: parameter.defaultValue ? String(parameter.defaultValue) : undefined
            // TODO: set the validateInput option to do range checking
        };
        return await vscode.window.showInputBox(opts);
    }
}

function quickPickFor(value : any) : AllowedValueQuickPickItem {
    return {
        label: String(value),
        description: '',
        value: value
    };
}

interface AllowedValueQuickPickItem extends vscode.QuickPickItem {
    value : any
}

interface ITempFileInfo {
    readonly abandoned : boolean;
    readonly path : string;
}

interface IParameterFileInfo {
    readonly exists : boolean;
    readonly path : string;
    readonly document? : vscode.TextDocument;
}
