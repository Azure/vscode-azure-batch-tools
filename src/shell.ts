import * as shelljs from 'shelljs';

export function exec(command : string) : Promise<IShellExecResult> {
    return new Promise<IShellExecResult>((resolve, reject) => {
        shelljs.exec(command, { async: true }, (code, stdout, stderr) => {
            resolve({ exitCode: code, output: stdout, error: stderr });
        });
    });
}

export interface IShellExecResult {
    readonly exitCode : number;
    readonly output : string;
    readonly error : string;
}

export interface ICommandError {
    readonly error : string;
}

export function isCommandError<T>(obj: T | ICommandError) : obj is ICommandError {
    return (<ICommandError>obj).error !== undefined;
}
