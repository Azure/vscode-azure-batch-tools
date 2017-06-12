'use strict';

import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import * as fs from 'fs';
import * as tmp from 'tmp';

import * as path from './path';
import * as batch from './batch';
import * as shell from './shell';
import * as azurebatchtree from './azurebatchtree';

var output : vscode.OutputChannel = vscode.window.createOutputChannel('Azure Batch');

export function activate(context: vscode.ExtensionContext) {

    const azureBatchProvider = new azurebatchtree.AzureBatchProvider();

    let disposables = [
        vscode.commands.registerCommand('azure.batch.createJob', createJob),
        vscode.commands.registerCommand('azure.batch.createPool', createPool),
        vscode.commands.registerCommand('azure.batch.createTemplateFromJob', createTemplateFromJob),
        vscode.commands.registerCommand('azure.batch.createTemplateFromPool', createTemplateFromPool),
        vscode.commands.registerCommand('azure.batch.convertToParameter', convertToParameter),
        vscode.commands.registerCommand('azure.batch.get', (node: azurebatchtree.AzureBatchTreeNode) => {
            vscode.workspace.openTextDocument(node.uri).then((doc) => vscode.window.showTextDocument(doc));
        }),
        vscode.commands.registerCommand('azure.batch.getAsTemplate', (node: azurebatchtree.AzureBatchTreeNode) => {
            // TODO: horrible smearing of responsibilities and duplication of code across this
            // and the get command - rationalise!
            const uri = node.uri;
            const resourceType = <batch.BatchResourceType> uri.authority;
            const id : string = uri.path.substring(0, uri.path.length - '.json'.length).substr(1);
            createTemplateFromSpecificResource(resourceType, id);
        }),
        vscode.commands.registerCommand('azure.batch.refresh', () => {vscode.window.showWarningMessage('not implemented');}),
        vscode.window.registerTreeDataProvider('azure.batch.explorer', azureBatchProvider),
        vscode.workspace.registerTextDocumentContentProvider('ab', azureBatchProvider)
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

async function createTemplateFromJob() {
    const resourceType : batch.BatchResourceType = 'job';
    const resourceTypePlural = 'jobs';
    await createTemplateFromResource(resourceType, resourceTypePlural);
}

async function createTemplateFromPool() {
    const resourceType : batch.BatchResourceType = 'pool';
    const resourceTypePlural = 'pools';
    await createTemplateFromResource(resourceType, resourceTypePlural);
}

async function createTemplateFromResource(resourceType : batch.BatchResourceType, resourceTypePlural : string) {

    output.appendLine(`Getting list of ${resourceTypePlural} from account...`);

    const resources = await batch.listResources(shell.exec, resourceType);

    if (shell.isCommandError(resources)) {
        output.appendLine(`Error getting ${resourceTypePlural} from account\n\nDetails:\n\n` + resources.error);
        return;
    }

    const quickPicks = resources.map((j) => quickPickForResource(j));
    const pick = await vscode.window.showQuickPick(quickPicks);

    if (pick) {
        const resource = pick.value;
        const template = batch.makeTemplate(resource, resourceType);
        const filename = resource.id + `.${resourceType}template.json`;
        createFile(filename, JSON.stringify(template, null, 2));
    }
}

async function createTemplateFromSpecificResource(resourceType: batch.BatchResourceType, id : string) {
    const resource = await batch.getResource(shell.exec, resourceType, id);
    const template = batch.makeTemplate(resource, resourceType);  // TODO: this puts it through the durationiser twice which results in manglage
    const filename = id + `.${resourceType}template.json`;
    createFile(filename, JSON.stringify(template, null, 2));
}

async function createFile(filename : string, content : string) : Promise<void> {
    const filepath = path.join(vscode.workspace.rootPath || process.cwd(), filename);

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:' + filepath));

    const start = new vscode.Position(0, 0),
        end = new vscode.Position(0, 0),
        range = new vscode.Range(start, end),
        edit = new vscode.TextEdit(range, content),
        wsEdit = new vscode.WorkspaceEdit();

    wsEdit.set(doc.uri, [edit]);
    await vscode.workspace.applyEdit(wsEdit);
    await vscode.window.showTextDocument(doc);
}

function quickPickForResource(resource: batch.IBatchResourceContent) : AllowedValueQuickPickItem {
    return {
        label: resource.id,
        description: resource.displayName || '',
        value: resource
    };
}

async function convertToParameter() {

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    const document = activeEditor.document;
    if (!document) {
        return;
    }

    const selection = activeEditor.selection;
    if (!selection) {
        return;
    }

    const jsonSymbols = await getJsonSymbols(document);
    if (jsonSymbols.length === 0) {
        return;
    }

    const property = findProperty(jsonSymbols, selection.anchor);
    if (!property) {
        return;
    }

    const propertyContainerName = property.containerName;
    if (!propertyContainerName.startsWith('job.properties')) {  // <- TODO
        return;
    }

    // TODO: we really want to do this only for leaf properties

    const propertyLocation = property.location.range;
    const propertyText = document.getText(propertyLocation);
    const nameBitLength = propertyText.indexOf(':') + 1;
    if (nameBitLength <= 0) {
        return;
    }
    const propertyValueLocation = new vscode.Range(propertyLocation.start.translate(0, nameBitLength), propertyLocation.end);
    const propertyValue = JSON.parse(document.getText(propertyValueLocation));

    const propertyType = getParameterTypeName(propertyValue); // consider getting this from Swagger?

    const parametersElement = jsonSymbols.find((s) => s.name == 'parameters' && !s.containerName);
    const needToCreateParametersElement = !parametersElement;

    // TODO: investigate using a smart insert for this (https://github.com/Microsoft/vscode/issues/3210)
    const newParameterDefn : any = {
        type: propertyType,
        defaultValue: propertyValue,
        metadata: { description: `Value for ${property.containerName}.${property.name}` }
    }

    let insertParamDefn : vscode.TextEdit;

    if (parametersElement) {
        const newParameterDefnText = `"${property.name}": ${JSON.stringify(newParameterDefn, null, 2)}`;
        const alreadyHasParameters = jsonSymbols.some((s) => s.containerName == 'parameters');
        const insert = (alreadyHasParameters ? ',\n' : '') + newParameterDefnText;  // TODO: line ending

        // insert this at the end of the parameters section
        const start = parametersElement.location.range.end.translate(0, -1),
            end = start,
            range = new vscode.Range(start, end);

        insertParamDefn = new vscode.TextEdit(range, insert);
    } else {
        let parameters : any = {};
        parameters[property.name] = newParameterDefn;
        const parametersSection = JSON.stringify({ parameters: parameters }, null, 2) + ',\n';  // TODO: line ending?
        // insert this at the top of the document, with suitable commas
        const start = new vscode.Position(1, 0),
            end = new vscode.Position(1, 0),
            range = new vscode.Range(start, end);

        insertParamDefn = new vscode.TextEdit(range, parametersSection);
    }

    const replaceValueWithParamRef = new vscode.TextEdit(propertyValueLocation, ` "[parameters('${property.name}')]"`);

    const wsEdit = new vscode.WorkspaceEdit();

    wsEdit.set(document.uri, [insertParamDefn, replaceValueWithParamRef]);
    await vscode.workspace.applyEdit(wsEdit);

    activeEditor.revealRange(insertParamDefn.range);
    activeEditor.selection = new vscode.Selection(insertParamDefn.range.start, insertParamDefn.range.end);  // TODO: this ends on the comma beforehand...
}

async function getJsonSymbols(document : vscode.TextDocument) : Promise<vscode.SymbolInformation[]> {
    const sis : any = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
    
    if (sis && sis.length) {
        return sis;
    }

    return [];
}

function findProperty(symbols: vscode.SymbolInformation[], position: vscode.Position) : vscode.SymbolInformation | null {
    const containingSymbols = symbols.filter((s) => s.location.range.contains(position));
    if (!containingSymbols || containingSymbols.length === 0) {
        return null;
    }
    // TODO: is it always the last one in the collection?  Not sure what guarantees we have...
    const sorted = containingSymbols.sort((a, b) => (a.containerName || '').length - (b.containerName || '').length);
    return sorted[sorted.length - 1];
}

function getParameterTypeName(value : any) : string {
    return (value instanceof Number || typeof value == 'number') ? 'integer' :
        (value instanceof Boolean || typeof value == 'boolean') ? 'boolean' :
        (value instanceof String || typeof value == 'string') ? 'string' :
        'object';
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
