import * as path from 'path';

export function join(...paths : string[]) : string {
    return path.join(...paths);
}
export function stripExtension(filePath : string) : string {
    // TODO: this will get it wrong if the file has no extension *and* the
    // directory path contains a directory with an extension. This isn't really
    // a concern for our use case though would be nice to fix.
    const sepIndex = filePath.lastIndexOf('.');
    if (sepIndex < 0) {
        return filePath;
    }
    return filePath.substr(0, sepIndex);
}

export function directory(filePath : string) : string {
    return path.dirname(filePath);
}

export function equal(filePath1 : string, filePath2 : string) : boolean {
    const fwd1 = filePath1.replace(/\\/g, '/');
    const fwd2 = filePath2.replace(/\\/g, '/');
    if (process.platform === 'win32') {
        return fwd1.toLowerCase() === fwd2.toLowerCase();
    }
    return fwd1 === fwd2;
}