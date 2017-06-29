import * as vscode from 'vscode';
import * as batch from './batch';
import * as shell from './shell';
import * as host from './host';

export const UriScheme : string = 'ab';

export class AzureBatchProvider implements vscode.TreeDataProvider<AzureBatchTreeNode> {
	private _onDidChangeTreeData: vscode.EventEmitter<AzureBatchTreeNode | undefined> = new vscode.EventEmitter<AzureBatchTreeNode | undefined>();
	readonly onDidChangeTreeData: vscode.Event<AzureBatchTreeNode | undefined> = this._onDidChangeTreeData.event;

    getTreeItem(abtn : AzureBatchTreeNode) : vscode.TreeItem {
        const collapsibleState = abtn.kind === 'root'
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        let item = new vscode.TreeItem(abtn.text, collapsibleState);
        item.contextValue = 'azure.batch.' + abtn.kind;
        if (isResourceNode(abtn)) {
            item.command = {
                command: 'azure.batch.getBatchResource',
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
                    host.writeOutput(listResult.error);
                    return [ new ErrorNode('Error - see output window for details') ];
                }
                return listResult.map((r) => new ResourceNode(r.id, abtn.resourceType, r));
            } else if (isResourceNode(abtn)) {
                return [];
            }
            return [];
        }
        return [new RootNode("Jobs", 'job'), new RootNode("Pools", 'pool')];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

function isRootNode(node : AzureBatchTreeNode) : node is RootNode {
    return node.kind === 'root';
}

export function isResourceNode(node : AzureBatchTreeNode) : node is ResourceNode {
    return node.kind === 'resource';
}

export interface AzureBatchTreeNode {
    readonly kind : AbtnKind;
    readonly text : string;
    readonly resourceType? : batch.BatchResourceType;
    readonly resourceId? : string;
}

type AbtnKind = 'root' | 'resource' | 'error';

class RootNode implements AzureBatchTreeNode {
    constructor(readonly text : string, readonly resourceType : batch.BatchResourceType) { }
    readonly kind : AbtnKind = 'root';
}

class ResourceNode implements AzureBatchTreeNode {
    constructor(readonly text : string, readonly resourceType : batch.BatchResourceType, readonly resource : any) { }
    readonly kind : AbtnKind = 'resource';
    readonly resourceId : string = this.resource.id;
}

class ErrorNode implements AzureBatchTreeNode {
    constructor(readonly text : string) { }
    readonly kind : AbtnKind = 'error';
}