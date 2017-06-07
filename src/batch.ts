export function parseBatchTemplate(text : string, resourceType : BatchResourceType) : IBatchResource | null {
    
    try {

        const jobject : any = JSON.parse(text);
        if (!jobject) {
            return null;
        }

        if (looksLikeTemplate(jobject, resourceType)) {
            return parseTemplateCore(jobject);
        }

        return { isTemplate: false, parameters: [] };

    } catch (SyntaxError) {
        return null;
    }
}

function looksLikeTemplate(json : any, resourceType : BatchResourceType) : boolean {
    const resourceDecl = json[resourceType];
    if (!resourceDecl) {
        return false;
    }

    if (resourceDecl.type && resourceDecl.properties) {
        return resourceDecl.type == "Microsoft.Batch/batchAccounts/" + plural(resourceType);
    }

    return false;
}

function plural(resourceType : BatchResourceType) : string {
    switch (resourceType) {
        case 'job': return 'jobs';
        case 'pool': return 'pools';
        default: throw `unknown resource type ${resourceType}`;
    }
}

function parseTemplateCore(json : any) : IBatchResource {
    
    const parameters : IBatchTemplateParameter[] = [];

    for (const p in json.parameters || []) {
        const pval : any = json.parameters[p];
        parameters.push({
            name : p,
            dataType : <BatchTemplateParameterDataType>(pval['type']),
            defaultValue : pval['defaultValue'],
            allowedValues : pval['allowedValues'],
            metadata : <IBatchTemplateParameterMetadata>(pval['metadata']),
        })
    }

    return { isTemplate: true, parameters: parameters };

}

export function parseParameters(text : string) : IParameterValue[] {
    try {

        const jobject : any = JSON.parse(text);
        if (!jobject) {
            return [];
        }

        return parseParametersCore(jobject);

    } catch (SyntaxError) {
        return [];
    }
}

function parseParametersCore(json : any) : IParameterValue[] {
    
    const parameters : IParameterValue[] = [];

    for (const key in json) {
        parameters.push({
            name : key,
            value : json[key]
        })
    }

    return parameters;
}

export interface IBatchResource {
    readonly isTemplate : boolean;
    readonly parameters : IBatchTemplateParameter[];
}

export interface IBatchTemplateParameter {
    readonly name : string;
    readonly dataType : BatchTemplateParameterDataType;
    readonly defaultValue? : any;
    readonly allowedValues? : any[];
    readonly metadata? : IBatchTemplateParameterMetadata;
}

export interface IBatchTemplateParameterMetadata {
    readonly description : string;
}

export type BatchTemplateParameterDataType = 'int' | 'string' | 'bool';

export interface IParameterValue {
    readonly name : string;
    readonly value : any;
}

export type BatchResourceType = 'job' | 'pool';