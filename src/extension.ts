'use strict';

import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import * as fs from 'fs';
import * as tmp from 'tmp';

import * as path from './path';
import * as batch from './batch';
import * as shell from './shell';
import * as azurebatchtree from './azurebatchtree';
import * as host from './host';
import * as textmodels from './textmodels';

let diagnostics : vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {

    const azureBatchProvider = new azurebatchtree.AzureBatchProvider();
    diagnostics = vscode.languages.createDiagnosticCollection('json');

    // TODO: This seems very unwieldy, and our method relies on symbols
    // which are only loaded asynchronously so the initial document doesn't
    // get checked until it changes.
    vscode.workspace.onDidOpenTextDocument(diagnoseTemplateProblems, undefined, context.subscriptions);
    vscode.workspace.onDidCloseTextDocument((textDocument) => {
        diagnostics.delete(textDocument.uri);
    }, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument((ch) => {
        diagnoseTemplateProblems(ch.document);
    }, null, context.subscriptions);
    vscode.workspace.onDidSaveTextDocument(diagnoseTemplateProblems, undefined, context.subscriptions);
    vscode.workspace.textDocuments.forEach(diagnoseTemplateProblems, undefined);

    let disposables = [
        vscode.commands.registerCommand('azure.batch.createJob', createJob),
        vscode.commands.registerCommand('azure.batch.createPool', createPool),
        vscode.commands.registerCommand('azure.batch.createTemplateFromJob', createTemplateFromJob),
        vscode.commands.registerCommand('azure.batch.createTemplateFromPool', createTemplateFromPool),
        vscode.commands.registerCommand('azure.batch.convertToParameter', convertToParameter),
        vscode.commands.registerCommand('azure.batch.get', viewnodeGet),
        vscode.commands.registerCommand('azure.batch.getAsTemplate', viewnodeGetAsTemplate),
        vscode.commands.registerCommand('azure.batch.refresh', () => azureBatchProvider.refresh()),
        vscode.window.registerTreeDataProvider('azure.batch.explorer', azureBatchProvider),
        vscode.workspace.registerTextDocumentContentProvider(azurebatchtree.UriScheme, azureBatchProvider),
        vscode.languages.registerCompletionItemProvider('json', new ParameterReferenceCompletionItemProvider()),
        diagnostics
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
        await vscode.window.showErrorMessage(`Current file is not an Azure Batch ${resourceType} template.`);
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
    const isKnownParameter = (n : string) => knownParameters.findIndex((p) => p.name === n) >= 0;
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

    host.writeOutput(`Creating Azure Batch ${resourceType}...`);

    shelljs.exec(`az batch ${resourceType} create ${commandOptions}`, { async: true }, (code : number, stdout : string, stderr : string) => {
        cleanup();

        if (code !== 0 || stderr) {  // TODO: figure out what to check (if anything) - problem is that the CLI can return exit code 0 on failure... but it writes to stderr on success too (the experimental feature warnings)
            host.writeOutput(stderr);
        } else {
            host.writeOutput(stdout);
        }

        host.writeOutput("Done");
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
        const known = knownParameters.find((pv) => pv.name === p.name);
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

    host.writeOutput(`Getting list of ${resourceTypePlural} from account...`);

    const resources = await batch.listResources(shell.exec, resourceType);

    if (shell.isCommandError(resources)) {
        host.writeOutput(`Error getting ${resourceTypePlural} from account\n\nDetails:\n\n` + resources.error);
        return;
    }

    const quickPicks = resources.map((j) => quickPickForResource(j));
    const pick = await vscode.window.showQuickPick(quickPicks);

    if (pick) {
        const resource = pick.value;
        await createTemplateFile(resourceType, resource, resource.id);
    }
}

async function createTemplateFromSpecificResource(resourceType: batch.BatchResourceType, id : string) {
    const resource = await batch.getResource(shell.exec, resourceType, id);
    await createTemplateFile(resourceType, resource, id);
}

async function createTemplateFile(resourceType : batch.BatchResourceType, resource : any, id : string) {
    const template = batch.makeTemplate(resource, resourceType);
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

    const convertResult = await convertToParameterCore(document, selection);

    if (isTextEdit(convertResult)) {
        activeEditor.revealRange(convertResult.range);
        activeEditor.selection = new vscode.Selection(convertResult.range.start, convertResult.range.end);
    } else {
        vscode.window.showErrorMessage(convertResult);
    }
}

function isTextEdit(obj : vscode.TextEdit | string) : obj is vscode.TextEdit {
    return (<vscode.TextEdit>obj).range !== undefined;
}

// TODO: any better way to make available for testing?
export async function convertToParameterCore(document: vscode.TextDocument, selection: vscode.Selection) : Promise<vscode.TextEdit | string> {

    const jsonSymbols = await getJsonSymbols(document);
    if (jsonSymbols.length === 0) {
        return 'Active document is not a JSON document';
    }

    const property = findProperty(jsonSymbols, selection.anchor);
    if (!property) {
        return 'Selection is not a JSON property';
    }

    const propertyContainerName = property.containerName;
    if (!(propertyContainerName.startsWith('job.properties') || propertyContainerName.startsWith('pool.properties'))) {
        return 'Selection is not a resource property';
    }

    // TODO: we really want to do this only for leaf properties

    const propertyLocation = property.location.range;
    const propertyText = document.getText(propertyLocation);
    const nameBitLength = propertyText.indexOf(':') + 1;
    if (nameBitLength <= 0) {
        return 'Cannot locate property name';
    }
    const propertyValueLocation = new vscode.Range(propertyLocation.start.translate(0, nameBitLength), propertyLocation.end);
    const propertyValue = JSON.parse(document.getText(propertyValueLocation));

    const propertyType = getParameterTypeName(propertyValue); // consider getting this from Swagger?

    // TODO: investigate using a smart insert for this (https://github.com/Microsoft/vscode/issues/3210)
    // (Currently doesn't seem to be a thing - works for completion items only...?)
    const newParameterDefn : any = {
        type: propertyType,
        defaultValue: propertyValue,
        metadata: { description: `Value for ${property.containerName}.${property.name}` }
    }

    const insertParamEdit = textmodels.getTemplateParameterInsertion(jsonSymbols, property.name, newParameterDefn);

    const replaceValueWithParamRef = new vscode.TextEdit(propertyValueLocation, ` "[parameters('${property.name}')]"`);

    await applyEdits(document, insertParamEdit, replaceValueWithParamRef);

    return insertParamEdit;
}

async function applyEdits(document : vscode.TextDocument, ...edits : vscode.TextEdit[]) : Promise<boolean> {
    const wsEdit = new vscode.WorkspaceEdit();
    wsEdit.set(document.uri, edits);
    return await vscode.workspace.applyEdit(wsEdit);
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
    const sorted = containingSymbols.sort((a, b) => (a.containerName || '').length - (b.containerName || '').length);
    return sorted[sorted.length - 1];
}

function getParameterTypeName(value : any) : string {
    return (value instanceof Number || typeof value === 'number') ? 'integer' :
        (value instanceof Boolean || typeof value === 'boolean') ? 'boolean' :
        (value instanceof String || typeof value === 'string') ? 'string' :
        'object';
}

async function viewnodeGet(node : azurebatchtree.AzureBatchTreeNode) {
    const document = await vscode.workspace.openTextDocument(node.uri)
    vscode.window.showTextDocument(document);
}

async function viewnodeGetAsTemplate(node : azurebatchtree.AzureBatchTreeNode) {
    // TODO: horrible smearing of responsibilities and duplication of code across this
    // and the get command - rationalise!
    const uri = node.uri;
    const resourceType = <batch.BatchResourceType> uri.authority;
    const id : string = uri.path.substring(0, uri.path.length - '.json'.length).substr(1);
    await createTemplateFromSpecificResource(resourceType, id);
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

class ParameterReferenceCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) : vscode.ProviderResult<vscode.CompletionItem[]> {
        return provideCompletionItemsCore(document, position, token);  // Helper method allows us to use async/await
    }
}

async function provideCompletionItemsCore(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) : Promise<vscode.CompletionItem[]> {
    const sis : vscode.SymbolInformation[] = await getJsonSymbols(document);  // We use this rather than JSON.parse because the document is likely to be invalid JSON at the time the user is in the middle of typing the completion trigger
    if (sis) {
        return sis.filter((si) => si.containerName === 'parameters')
                  .map((si) => completionItemFor(si));
    }
    return [];
}

function completionItemFor(si : vscode.SymbolInformation) : vscode.CompletionItem {
    let ci = new vscode.CompletionItem(`batch.parameter-ref('${si.name}')`);
    ci.insertText = `"[parameter('${si.name}')]"`;
    ci.documentation = `A reference to the '${si.name}' template parameter`;
    ci.detail = `vscode-azure-batch-tools`;
    return ci;
}

interface IParameterRefMatch {
    readonly index : number;
    readonly name : string;
}

function parameterRefs(text : string) : IParameterRefMatch[] {
    let refs : IParameterRefMatch[] = [];
    let parameterRegex = /\"\[parameters\('(\w+)'\)\]"/g;
    let match : any;
    while ((match = parameterRegex.exec(text)) !== null) {
        let index : number = match.index + "\"[parameters('".length;
        let name : string = match[1];
        refs.push({ index: index, name : name });
    }
    return refs;
}

async function diagnoseTemplateProblems(document : vscode.TextDocument) : Promise<void> {
    if (document.languageId !== 'json') {
        return;
    }

    let ds : vscode.Diagnostic[] = [];

    const sis : vscode.SymbolInformation[] = await getJsonSymbols(document);
    if (sis && sis.length > 0 /* don't report warnings just because the symbols haven't loaded yet */) {
        const paramNames = sis.filter((si) => si.containerName === 'parameters')
                              .map((si) => si.name);
        const paramRefs = parameterRefs(document.getText());
        if (paramRefs) {
            for (const paramRef of paramRefs) {
                if (paramNames.indexOf(paramRef.name) < 0) {
                    const startPos = document.positionAt(paramRef.index);
                    const endPos = document.positionAt(paramRef.index + paramRef.name.length);
                    // TODO: perhaps a CodeActionProvider would be better because then
                    // we could offer to create the parameter?
                    const d = new vscode.Diagnostic(new vscode.Range(startPos, endPos), `Unknown parameter name ${paramRef.name}`, vscode.DiagnosticSeverity.Warning);
                    ds.push(d);
                }
            }
        }
    }

    diagnostics.set(document.uri, ds);
}
