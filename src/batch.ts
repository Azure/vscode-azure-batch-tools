import { IShellExecResult, ICommandError } from './shell';
import * as duration from './duration';

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
        return resourceDecl.type == templateResourceType(resourceType);
    }

    return false;
}

function templateResourceType(resourceType : BatchResourceType) : string {
    return "Microsoft.Batch/batchAccounts/" + plural(resourceType);
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

export async function listResources(shellExec : (command : string) => Promise<IShellExecResult>, resourceType : BatchResourceType) : Promise<IBatchResourceContent[] | ICommandError> {
    //const command = `az batch ${resourceType} list --query [*].{id:id,displayName:displayName}`;  // the problem is we are going to want to stringify the resource JSON and that means we need to download it - or do a second call
    const command = `az batch ${resourceType} list`;
    const result = await shellExec(command);
    if (result.exitCode === 0) {
        const raw : any[] = JSON.parse(result.output);
        const durationised = raw.map((r) => transformProperties(r, durationProperties(resourceType), duration.toISO8601));
        return durationised;
    }
    return { error : result.error };
}

export async function getResource(shellExec : (command : string) => Promise<IShellExecResult>, resourceType : BatchResourceType, id : string) : Promise<IBatchResourceContent | ICommandError> {
    const command = `az batch ${resourceType} show --${resourceType}-id ${id}`;
    const result = await shellExec(command);
    if (result.exitCode === 0) {
        const raw = JSON.parse(result.output);
        const durationised = transformProperties(raw, durationProperties(resourceType), duration.toISO8601);
        return durationised;
    }
    return { error : result.error };
}

export function makeTemplate(resource : any, resourceType : BatchResourceType) : any {

    const filtered = removeProperties(resource, unsettableProperties(resourceType));
    // TODO: strip defaults (particularly nulls or empty objects) - we get null-stripping as a side-effect of transformProperties but shouldn't rely on this!
    const templateBody = filtered;

    var template : any = {
        parameters: { }
    };

    template[resourceType] = {
        type: templateResourceType(resourceType),
        apiVersion: '2017-05-01',
        properties: templateBody
    }

    return template;
}

function removeProperties(resource : any, properties : string[]) : any {
    var result : any = {};
    for (const property in resource) {
        if (properties.indexOf(property) < 0) {
            result[property] = resource[property];
        }
    }
    return result;
}

function transformProperties(obj : any, properties: string[], transform : (original : string | undefined) => string | undefined) : any {
    var result : any = {};
    for (const property in obj) {
        const value = obj[property];
        if (value instanceof Array) {
            result[property] = value.map((e : any) => transformProperties(e, properties, transform));
        } else if (value instanceof Object) {
            result[property] = transformProperties(value, properties, transform);
        } else {
            const needsTransform = properties.indexOf(property) >= 0;
            const resultProperty = needsTransform ? transform(value) : value;
            if (resultProperty !== undefined && resultProperty !== null) {
                result[property] = resultProperty;
            }
        }
    }
    return result;
}

// This isn't ideal since it doesn't cover property paths, but it will do
function durationProperties(resourceType : BatchResourceType) : string[] {
    switch (resourceType) {
        case 'job':
            return [ 'maxWallClockTime', 'retentionTime' ];
        case 'pool':
            return [ 'resizeTimeout' ];
        default:
            throw `unknown resource type ${resourceType}`;
    }
}

function unsettableProperties(resourceType : BatchResourceType) : string[] {
    // TODO: better plan might be to whitelist properties by using the Swagger spec
    // for the 'add' models.
    const commonUnsettableProperties = ["odata.metadata", "url", "eTag", "lastModified", "creationTime", "state", "stateTransitionTime", "previousState", "previousStateTransitionTime"];
    return commonUnsettableProperties.concat(unsettablePropertiesCore(resourceType));
}

function unsettablePropertiesCore(resourceType : BatchResourceType) : string[] {
    // TODO: better plan might be to whitelist properties by using the Swagger spec
    // for the 'add' models.
    switch (resourceType) {
        case 'job':
            return ["executionInfo", "stats"];
        case 'pool':
            return ["allocationState", "allocationStateTransitionTime", "resizeErrors", "currentDedicatedNodes", "currentLowPriorityNodes", "autoScaleRun", "stats"];
        default:
            throw `unknown resource type ${resourceType}`;
    }
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

export interface IBatchResourceContent {
    readonly id : string;
    readonly displayName? : string;
}

export type BatchResourceType = 'job' | 'pool';