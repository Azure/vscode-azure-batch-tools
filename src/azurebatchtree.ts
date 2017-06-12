import * as vscode from 'vscode';
import * as batch from './batch';
import * as shell from './shell';

export const UriScheme : string = 'ab';

export class AzureBatchProvider implements vscode.TreeDataProvider<AzureBatchTreeNode>, vscode.TextDocumentContentProvider {
    getTreeItem(abtn : AzureBatchTreeNode) : vscode.TreeItem {
        const collapsibleState = abtn.kind == 'root' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        let item = new vscode.TreeItem(abtn.text, collapsibleState);
        item.contextValue = 'azure.batch.' + abtn.kind;
        if (isResourceNode(abtn)) {
            item.command = {
                command: 'azure.batch.get',
                arguments: [abtn],
                title: 'Get'
            };
        }
        return item;
    }
    async getChildren(abtn? : AzureBatchTreeNode) : Promise<AzureBatchTreeNode[]> {
        if (abtn) {
            if (isRootNode(abtn)) {
                const listResult = await batch.listResources(shell.exec, abtn.resourceType);
                if (shell.isCommandError(listResult)) {
                    return [];
                }
                return listResult.map((r) => new ResourceNode(r.id, abtn.resourceType, r));
            } else if (isResourceNode(abtn)) {
                return [];
            }
            return [];
        }
        return [new RootNode("Jobs", 'job'), new RootNode("Pools", 'pool')];
    }
    provideTextDocumentContent(uri: vscode.Uri, token : vscode.CancellationToken) : vscode.ProviderResult<string> {
        const resourceType = <batch.BatchResourceType> uri.authority;
        const id : string = uri.path.substring(0, uri.path.length - '.json'.length).substr(1);
        return this.getBatchResourceJson(resourceType, id);
    }
    private async getBatchResourceJson(resourceType : batch.BatchResourceType, id : string) : Promise<string> {
        const getResult = await batch.getResource(shell.exec, resourceType, id);
        if (shell.isCommandError(getResult)) {
            throw getResult.error;
        }
        return JSON.stringify(getResult, null, 2);
    }
}

function isRootNode(node : AzureBatchTreeNode) : node is RootNode {
    return node.kind == 'root';
}

function isResourceNode(node : AzureBatchTreeNode) : node is ResourceNode {
    return node.kind == 'resource';
}

export interface AzureBatchTreeNode {
    readonly kind : AbtnKind;
    readonly text : string;
    readonly resourceType : batch.BatchResourceType;
    readonly uri : vscode.Uri;
}

type AbtnKind = 'root' | 'resource';

class RootNode implements AzureBatchTreeNode {
    constructor(readonly text : string, readonly resourceType : batch.BatchResourceType) { }
    readonly kind : AbtnKind = 'root';
    readonly uri : vscode.Uri = vscode.Uri.parse(`${UriScheme}://`);
}

class ResourceNode implements AzureBatchTreeNode {
    constructor(readonly text : string, readonly resourceType : batch.BatchResourceType, readonly resource : any) { }
    readonly kind : AbtnKind = 'resource';
    readonly uri : vscode.Uri = vscode.Uri.parse(`${UriScheme}://${this.resourceType}/${this.resource.id}.json`)
}
