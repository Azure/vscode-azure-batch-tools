import * as vscode from 'vscode';
import * as batch from './batch';
import * as shell from './shell';

export class AzureBatchProvider implements vscode.TreeDataProvider<AzureBatchTreeNode> {
    getTreeItem(abtn : AzureBatchTreeNode) : vscode.TreeItem {
        const collapsibleState = abtn.kind == 'root' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        let item = new vscode.TreeItem(abtn.text, collapsibleState);
        item.contextValue = 'azure.batch.' + abtn.kind;
        return item;
    }
    async getChildren(abtn? : AzureBatchTreeNode) : Promise<AzureBatchTreeNode[]> {
        if (abtn) {
            if (isRootNode(abtn)) {
                const listResult = await batch.listResources(shell.exec, abtn.resourceType);
                if (shell.isCommandError(listResult)) {
                    return [];
                }
                return listResult.map((r) => new ResourceNode(r.id));
            } else if (isResourceNode(abtn)) {
                return [];
            }
            return [];
        }
        return [new RootNode("Jobs", 'job'), new RootNode("Pools", 'pool')];
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
}

type AbtnKind = 'root' | 'resource';

class RootNode implements AzureBatchTreeNode {
    constructor(readonly text : string, readonly resourceType : batch.BatchResourceType) { }
    readonly kind : AbtnKind = 'root';
}

class ResourceNode implements AzureBatchTreeNode {
    constructor(readonly text : string) { }
    readonly kind : AbtnKind = 'resource';
}
