import * as https from 'https';
import * as http from 'http';
import * as batch from '../src/batch';
import * as path from 'path';
import * as fs from 'fs';

writeResourceSchemas().then(() => {console.log('done');});

const implicitExtensionTypes = [
    {
        "name": "RepeatTask",
        "basedOn": "TaskAddParameter",
        "removing": ["id", "dependsOn"]
    }
];

// Additional JSON Schema elements to be merged with the specified definitions -
// refer to JSON Schema documentation for semantics.  These capture information which
// is only in documentation in the Swagger spec.
const enrichments : any = {
    PoolInformation: {
        oneOf: [
            { required: ["poolId"] },
            { required: ["autoPoolSpecification"] }
        ]
    },
    PoolAddParameter: {
        oneOf: [
            { required: ["cloudServiceConfiguration"] },
            { required: ["virtualMachineConfiguration"] }
            // TODO: is there a nice way in JSON Schema to express independent oneOfs (specifically for targetDedicated and autoScaleFormula independently of the CSC/VMC alternate)
        ],
        dependencies: {
            autoScaleFormula: ["enableAutoScale"],
            autoScaleEvaluationInterval: ["enableAutoScale"]
            // TODO: would like to express e.g. "ASF depends on EAS being present **and true**" - JSON Schema may be able to do this but the VS Code validator doesn't seem to handle it yet
        }
    },
    PoolSpecification: {
        oneOf: [
            { required: ["cloudServiceConfiguration"] },
            { required: ["virtualMachineConfiguration"] }
            // TODO: is there a nice way in JSON Schema to express independent oneOfs (specifically for targetDedicated and autoScaleFormula independently of the CSC/VMC alternate)
        ],
        dependencies: {
            autoScaleFormula: ["enableAutoScale"],
            autoScaleEvaluationInterval: ["enableAutoScale"]
        }
    },
    VirtualMachineConfiguration: {
        oneOf: [
            { required: ["imageReference"] },
            { required: ["osDisk"] }
        ]
    },
    ResourceFile: {
        oneOf: [
            { required: ["source"] },
            { required: ["blobSource"] }
        ],
        required: []
    }
};

async function writeResourceSchemas() {
    await writeResourceSchema('job');
    await writeResourceSchema('pool');
    await writeTemplateSchema('job');
    await writeTemplateSchema('pool');
    await writeApplicationTemplateSchema();
}

async function writeResourceSchema(resourceType : batch.BatchResourceType) : Promise<void> {
    const schema = await createResourceSchema(resourceType);
    const schemaText = JSON.stringify(schema, null, 2);
    const schemaFilePath = path.join(__dirname, `../../schema/${resourceType}.schema.json`);
    fs.writeFileSync(schemaFilePath, schemaText);
}

async function writeTemplateSchema(resourceType: batch.BatchResourceType) : Promise<void> {
    const schema = await createTemplateSchema(resourceType);
    const schemaText = JSON.stringify(schema, null, 2);
    const schemaFilePath = path.join(__dirname, `../../schema/${resourceType}template.schema.json`);
    fs.writeFileSync(schemaFilePath, schemaText);
}

const applicationTemplateableProperties = [
    "jobManagerTask",
    "jobPreparationTask",
    "jobReleaseTask",
    "commonEnvironmentSettings",
    "usesTaskDependencies",
    "onAllTasksComplete",
    "onTaskFailure",
    "taskFactory",
    "metadata"
];

async function writeApplicationTemplateSchema() : Promise<void> {
    const schema = await createApplicationTemplateSchema();
    const schemaText = JSON.stringify(schema, null, 2);
    const schemaFilePath = path.join(__dirname, `../../schema/applicationtemplate.schema.json`);
    fs.writeFileSync(schemaFilePath, schemaText);
}

async function createApplicationTemplateSchema() : Promise<any> {
    const appTemplateSchemaTemplatePath = path.join(__dirname, "../../tools/applicationtemplate.schematemplate.json");
    let appTemplateSchema : any = JSON.parse(fs.readFileSync(appTemplateSchemaTemplatePath, 'utf8'));
    fixAllDefinitionsSoTitlesShowInJsonValidation(appTemplateSchema);
    const jobSchema = await createResourceSchema('job');
    addParameterSupport(jobSchema.definitions);
    for (const d in jobSchema.definitions) {
        appTemplateSchema.definitions[d] = jobSchema.definitions[d];
    }
    const jobResourceSchema = jobSchema.definitions['JobAddParameter'];
    for (const p in jobResourceSchema.properties) {
        if (applicationTemplateableProperties.indexOf(p) >= 0) {
            appTemplateSchema.definitions['BatchApplicationTemplate'].properties[p] = jobResourceSchema.properties[p];
        }
    }
    return appTemplateSchema;
}

async function createResourceSchema(resourceType : batch.BatchResourceType) : Promise<any> {
    let schemaDefinitions : any = {};
    const swagger = await fetchSwagger();
    extendSchemaForBatchExtensions(swagger.definitions);
    const addResourceOperation = swagger.paths[resourcePath(resourceType)].post;
    const addResourceBodySchemaRef : string = addResourceOperation.parameters.find((p: any) => p.in === 'body').schema['$ref'];

    const bodySchema = chaseRef(swagger, addResourceBodySchemaRef);

    schemaDefinitions[bodySchema.name] = bodySchema.schema;
    fixSchemaSoTitlesShowInJsonValidation(schemaDefinitions[bodySchema.name]);

    recursivelyAddDefns(swagger, bodySchema.schema, schemaDefinitions);

    enrichSchema(schemaDefinitions);  // do this here to save us having to deal with oneOf etc. in the recursive addition process

    const schema : any = {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        title: resourceType,
        description: `An Azure Batch ${resourceType}`,
        type: 'object',
        '$ref': `#/definitions/${bodySchema.name}`,
        definitions: schemaDefinitions
    };

    return schema;
}

// NOTE: VS Code JSON validation has a bug where it shows description rather than title
// in intellisense. We could write the template schema template to return descriptions,
// but in order to keep it 'correct' we return titles and fix them up in the same way
// as we fix up the definitions that we source from Swagger.
function templateSchemaTemplate(resourceType: batch.BatchResourceType) : any {
    const pascalCased = resourceType[0].toUpperCase() + resourceType.substring(1);
    return {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        title: `${resourceType}template`,
        description: `An Azure Batch ${resourceType} template`,
        type: "object",
        '$ref': `#/definitions/${pascalCased}Template`,
        definitions: {
            [`${pascalCased}Template`]: {
                properties: {
                    parameters: {
                        type: "object",
                        additionalProperties: {
                            type: "object",
                            "$ref": "#/definitions/BatchTemplateParameter"
                        },
                        title: "The parameters whose values may be supplied each time the template is used."
                    },
                    [resourceType]: {
                        type: "object",
                        "$ref": `#/definitions/${pascalCased}Template${pascalCased}`,
                        title: `The resource to be created from the template.`
                    }
                },
                required: [resourceType],
                title: `An Azure Batch ${resourceType} template.`
            },
            BatchTemplateParameter: {
                properties: {
                    type: {
                        type: "string",
                        enum: [ "int", "string", "bool" ],
                        title: "The data type of the parameter."
                    },
                    defaultValue: {
                        title: "The default value of the parameter."
                    },
                    allowedValues: {
                        type: "array",
                        title: "The allowed values of the parameter."
                    },
                    minValue: {
                        type: "integer",
                        title: "The minimum value of the parameter."
                    },
                    maxValue: {
                        type: "integer",
                        title: "The maximum value of the parameter."
                    },
                    minLength: {
                        type: "integer",
                        title: "The minimum length of the parameter value."
                    },
                    maxLength: {
                        type: "integer",
                        title: "The maximum length of the parameter value."
                    },
                    metadata: {
                        type: "object",
                        "$ref": "#/definitions/BatchTemplateParameterMetadata",
                        title: "Additional data about the parameter."
                    }
                },
                required: ["type"]
            },
            BatchTemplateParameterMetadata: {
                properties: {
                    description: {
                        type: "string",
                        title: "A description of the parameter, suitable for display in a user interface."
                    }
                },
                title: "Additional data about an Azure Batch template parameter."
            },
            [`${pascalCased}Template${pascalCased}`]: {
                properties: {
                    type: {
                        type: "string",
                        title: `The type of Azure Batch resource to create. Must be '${templateResourceType(resourceType)}'.`,
                        enum: [templateResourceType(resourceType)]  // const not yet supported in VS Code
                    },
                    apiVersion: {
                        type: "string",
                        title: "The Azure Batch API version against which the template is written. Must be '2017-05-01.5.0'.",
                        enum: ["2017-05-01.5.0"]  // const not yet supported in VS Code
                    },
                    properties: {
                        type: "object",
                        "$ref": `#/definitions/${pascalCased}AddParameter`,  // except any property can also be a string because substitution - handled by the addParameterSupport transformation
                        title: `The ${resourceType} to be created from the template.`
                    }
                },
                required: [ "type", "apiVersion", "properties" ],
                title: "The resource to be created from an Azure Batch template."
            }
        }
    };
}

async function createTemplateSchema(resourceType: batch.BatchResourceType) : Promise<any> {
    const resourceSchema = await createResourceSchema(resourceType);
    addParameterSupport(resourceSchema.definitions);
    let templateSchema : any = templateSchemaTemplate(resourceType);
    fixAllDefinitionsSoTitlesShowInJsonValidation(templateSchema);  // Rather than compromise our template schema to deal with the VS Code title bug, we fix it up here
    Object.assign(templateSchema.definitions, resourceSchema.definitions);
    return templateSchema;
}

function addParameterSupport(definitions : any) : void {
    // so the idea is we go through all the properties
    // and change them all from type: X to anyOf: [ { type: X }, { type: string, pattern: param_regex } ]
    for (let d in definitions) {
        for (let pn in definitions[d].properties) {
            let p = definitions[d].properties[pn];
            const type = p.type;
            if (type === "integer" || type === "boolean") {
                p.anyOf = [
                    { type: type },
                    { type: "string", pattern: "\\[parameters\\('\\w+'\\)\\]" }
                ];
                delete p.type;
            }
        }
    }
}

function extendSchemaForBatchExtensions(definitions: any) : void {
    const extensionsText = fs.readFileSync(path.join(__dirname, `../../tools/extensions.schema.json`), 'utf8');
    const extensions : any = JSON.parse(extensionsText);
    mergeExtensions(extensions, definitions);
}

function mergeExtensions(extensions: any, base: any) {
    for (const p in extensions) {
        if (base[p]) {
            base[p].properties = Object.assign(base[p].properties, extensions[p].properties);
        } else {
            base[p] = extensions[p];
        }
    }
    fillInImplicitExtensionTypes(base);
}

function fillInImplicitExtensionTypes(definitions: any) {
    for (const extensionType of implicitExtensionTypes) {
        let basedOn = definitions[extensionType.basedOn];
        let definition : any = { properties: { } }; // can't use Object.assign({}, definitions[extensionType.basedOn]); because of shallow copies
        for (const property in basedOn.properties) {
            if (extensionType.removing.indexOf(property) < 0) {
                definition.properties[property] = basedOn.properties[property];
            }
        }
        definition.title = basedOn.title;
        definition.description = basedOn.description;
        definition.required = basedOn.required.filter((p : string) => extensionType.removing.indexOf(p) < 0);
        definitions[extensionType.name] = definition;
    }
}

function enrichSchema(definitions: any) {
    for (const e in enrichments) {
        let declaringType = definitions[e];
        if (declaringType) {  // we run this after filtering to the job or pool subset, so some enrichments may not relate to the definitions at hand
            declaringType = Object.assign(declaringType, enrichments[e]);
        }
    }
}

function chaseRef(swagger: any, ref: string) : { name: string, schema: any } {
    const refPath = ref.split('/');
    refPath.shift();
    let r = swagger;
    for (const p of refPath) {
        r = r[p];
    }
    const schema : any = r;
    const name = refPath.reverse()[0];
    return { name: name, schema: schema };
}

function recursivelyAddDefns(swagger: any, source: any, destination: any) : void {
    if (source.properties) {
        for (const p in source.properties) {
            if (source.properties[p]['$ref']) {
                const ref : string = source.properties[p]['$ref'];
                recursivelyAddDefnsForRef(swagger, ref, destination);
            } else if (source.properties[p].items && source.properties[p].items['$ref']) {
                const ref : string = source.properties[p].items['$ref'];
                recursivelyAddDefnsForRef(swagger, ref, destination);
            }
        }
    }
}

function recursivelyAddDefnsForRef(swagger: any, ref: string, destination: any) {
    const refSchema = chaseRef(swagger, ref);
    if (!destination[refSchema.name]) {
        destination[refSchema.name] = refSchema.schema;
        fixSchemaSoTitlesShowInJsonValidation(destination[refSchema.name]);
        recursivelyAddDefns(swagger, refSchema.schema, destination);
    }
}

function fixAllDefinitionsSoTitlesShowInJsonValidation(schema: any) : void {
    for (const p in schema.definitions) {  // Rather than compromise our template schema to deal with the VS Code title bug, we fix it up here
        fixSchemaSoTitlesShowInJsonValidation(schema.definitions[p]);
    }
}

function fixSchemaSoTitlesShowInJsonValidation(schema: any) : any {
    // Workaround for https://github.com/Microsoft/vscode/issues/28978
    if (schema.properties) {
        for (const p in schema.properties) {
            schema.properties[p].description = schema.properties[p].title;
        }
    }
}

function resourcePath(resourceType : batch.BatchResourceType) : string {
    switch (resourceType) {
        case 'job':
            return '/jobs';
        case 'pool':
            return '/pools';
        default:
            throw 'Unknown resource type ' + resourceType;
    }
}

// We don't want to take a runtime dependency on batch.ts as it indirectly
// imports the vscode module.  So we copy these two functions from there.
// (We are allowed to take compile time dependencies on type definitions.)

function templateResourceType(resourceType : batch.BatchResourceType) : string {
    return "Microsoft.Batch/batchAccounts/" + plural(resourceType);
}

function plural(resourceType : batch.BatchResourceType) : string {
    switch (resourceType) {
        case 'job': return 'jobs';
        case 'pool': return 'pools';
        default: throw `unknown resource type ${resourceType}`;
    }
}

// End of copy from the batch.ts module

export async function fetchSwagger() : Promise<any> {
    const swaggerUrl = `https://raw.githubusercontent.com/Azure/azure-rest-api-specs/master/batch/2017-05-01.5.0/swagger/BatchService.json`;
    const response = await httpsGet(swaggerUrl);
    if (response.statusCode === 200) {
        const swaggerText = await readText(response);
        const swagger : any = JSON.parse(swaggerText);
        return swagger;
    }
    response.resume();
    throw `Failed to download Swagger: ${response.statusCode} ${response.statusMessage}`;
}

function readText(response : http.IncomingMessage) : Promise<string> {
    return new Promise<string>((resolve, reject) => {
        if (response.statusCode === 200) {
            response.setEncoding('utf8');
            let text = '';
            response.on('data', (chunk) => { text += chunk; });
            response.on('end', () => {
                resolve(text);
                return;
            });
        } else {
            response.resume();
            reject("Failed to download Swagger");
        }
    });
}

function httpsGet(url : string) : Promise<http.IncomingMessage> {
    return new Promise<any>((resolve, reject) => {
        https.get(url, (result: http.IncomingMessage) => {
            resolve(result);
        });
    });
}