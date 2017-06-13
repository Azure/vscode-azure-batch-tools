import * as vscode from 'vscode';

const output : vscode.OutputChannel = vscode.window.createOutputChannel('Azure Batch');
let outputShown = false;

export function writeOutput(text : string) {
    if (!outputShown) {
        output.show();
    }
    output.appendLine(text);
}
