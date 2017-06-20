import * as https from 'https';
import * as http from 'http';
import * as batch from '../src/batch';
import * as path from 'path';
import * as fs from 'fs';

writeResourceSchemas().then(() => {console.log('done');});

// TODO:
// * smartness around combinations (e.g. oneOf poolId or autoPoolSpecification)
//   * can we handle the tweaking of TaskAddParameter for repeat tasks as part of this same transformation?

// transformations:
// * create a new definition by removing a property - DONE
// * modify a definition by defining either-or groups
//   * you must have ONE OF these groups
//   * each group may contain 1 or more elements from the original type
//   * these elements are removed from the top-level type
//   * ??? an element may be restated in more than one group ???
//   * some elements may become mandatory when restated at group level

const implicitExtensionTypes = [
    {
        "name": "RepeatTask",
        "basedOn": "TaskAddParameter",
        "removing": ["id", "dependsOn"]
    }
];

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
    }
};

async function writeResourceSchemas() {
    await writeResourceSchema('job');
    await writeResourceSchema('pool');
    await writeTemplateSchema('job');
    await writeTemplateSchema('pool');
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

async function createResourceSchema(resourceType : batch.BatchResourceType) : Promise<any> {
    let schemaDefinitions : any = {};
    const swagger = await fetchSwagger();
    extendSchemaForBatchExtensions(swagger.definitions);
    const addResourceOperation = swagger.paths[resourcePath(resourceType)].post;
    const addResourceBodySchemaRef : string = addResourceOperation.parameters[0 /* <- TODO: !!! */].schema['$ref'];

    const bodySchema = chaseRef(swagger, addResourceBodySchemaRef);

    schemaDefinitions[bodySchema.name] = bodySchema.schema;
    mungeSchema(schemaDefinitions[bodySchema.name]);

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
                        }
                    },
                    [resourceType]: {
                        type: "object",
                        "$ref": `#/definitions/${pascalCased}Template${pascalCased}`
                    }
                },
                required: [resourceType],
                title: "TBD"
            },
            BatchTemplateParameter: {
                properties: {
                    type: {
                        type: "string"
                    },  // TODO: defaultValue, allowedValues, etc.
                    metadata: {
                        type: "object",
                        "$ref": "#/definitions/BatchTemplateParameterMetadata"
                    }
                },
                required: ["type"]
            },
            BatchTemplateParameterMetadata: {
                properties: {
                    description: {
                        type: "string"
                    }
                },
                title: "TBD"
            },
            [`${pascalCased}Template${pascalCased}`]: {
                properties: {
                    type: {
                        type: "string",
                        title: "TBD"
                        /* permitted values? */
                    },
                    apiVersion: {
                        type: "string",
                        title: "TBD"
                        /* permitted values? */
                    },
                    properties: {
                        type: "object",
                        "$ref": `#/definitions/${pascalCased}AddParameter`,  // except any property can also be a string because substitution
                        title: "TBD"
                    }

                },
                required: [ "type", "apiVersion", "properties" ],
                title: "TBD"
            }
        }
    };
}

async function createTemplateSchema(resourceType: batch.BatchResourceType) : Promise<any> {
    const resourceSchema = await createResourceSchema(resourceType);
    let templateSchema : any = templateSchemaTemplate(resourceType);
    Object.assign(templateSchema.definitions, resourceSchema.definitions);
    return templateSchema;
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
        mungeSchema(destination[refSchema.name]);
        recursivelyAddDefns(swagger, refSchema.schema, destination);
    }
}

function mungeSchema(schema: any) : any {
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