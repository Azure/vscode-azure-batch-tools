export function parseBatchTemplate(text : string, resourceType : BatchResourceType) : IBatchTemplate | null {
    
    try {

        const jobject : any = JSON.parse(text);
        if (!jobject) {
            return null;
        }

        if (!jobject[resourceType]) {
            return null;
        }

        return parseTemplateCore(jobject);

    } catch (SyntaxError) {
        return null;
    }
}

function parseTemplateCore(json : any) : IBatchTemplate {
    
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

    return { parameters: parameters };

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

export interface IBatchTemplate {
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