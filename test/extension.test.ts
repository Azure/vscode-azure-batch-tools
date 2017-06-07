//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as batch from '../src/batch';

const nonJson = " \
  id : 'wonderjob' \
  poolInfo \
      poolId : 'wonderpool' \
";

const jobJson = ' \
{ \
  "id" : "wonderjob", \
  "poolInfo" : { \
      "poolId" : "wonderpool" \
  } \
} \
';

const jobTemplateJson = ' \
{ \
  "parameters": { \
    "jobId": { \
      "type": "string", \
      "metadata": { \
        "description": "The id of the Batch job" \
      } \
    }, \
    "poolId": { \
      "type": "string", \
      "metadata": { \
        "description": "The id of the Batch pool on which to run the job" \
      } \
    }, \
    "testDefaulted": { \
      "type": "string", \
      "defaultValue" : "mydef" \
    }, \
    "testAllowed": { \
      "type": "string", \
      "allowedValues" : [ "alpha", "bravo", "charlie" ] \
    } \
  }, \
  "job": { \
    "type": "Microsoft.Batch/batchAccounts/jobs", \
    "apiVersion": "2016-12-01", \
    "properties": { \
      "id": "[parameters(\'jobId\')]", \
      "poolInfo" : { \
          "poolId" : "wonderpool" \
      } \
    } \
  } \
} \
';

const jobTemplateJsonNoParams = ' \
{ \
  "job": { \
    "type": "Microsoft.Batch/batchAccounts/jobs", \
    "apiVersion": "2016-12-01", \
    "properties": { \
      "id" : "wonderjob", \
      "poolInfo" : { \
          "poolId" : "wonderpool" \
      } \
    } \
  } \
} \
';

const poolTemplateJson = ' \
{ \
  "parameters": { \
    "vmSize": { \
      "type": "string", \
      "allowedValues" : [ "STANDARD_A3", "STANDARD_A4" ], \
      "metadata": { \
        "description": "The size of virtual machine to use" \
      } \
    } \
  }, \
  "pool": { \
    "type": "Microsoft.Batch/batchAccounts/pools", \
    "apiVersion": "2016-12-01", \
    "properties": { \
      "id": "superduperpool", \
      "vmSize": "[parameters(\'vmSize\')]", \
      "targetDedicated": 4, \
      "cloudServiceConfiguration": { "osFamily": 4 } \
    } \
  } \
} \
';

suite('Batch Utilities Tests', () => {

    test('Parsing a non-JSON document as a job template fails', () => {
        const result = batch.parseBatchTemplate(nonJson, 'job');
        assert.equal(result, null);
    });

    test('Parsing a job JSON as a job template fails', () => {
        const result = batch.parseBatchTemplate(jobJson, 'job');
        assert.equal(result, null);
    });

    test('Parsing job template JSON as a job template succeeds', () => {
        const template = batch.parseBatchTemplate(jobTemplateJson, 'job');
        assert.notEqual(template, null);
    });

    test('Parsing job template JSON surfaces the parameters', () => {
        const template = <batch.IBatchTemplate>batch.parseBatchTemplate(jobTemplateJson, 'job');
        assert.equal(template.parameters.length, 4);
        
        const jobIdParameter = template.parameters[0];
        assert.equal('jobId', jobIdParameter.name);
        assert.equal('string', jobIdParameter.dataType);
        assert.notEqual(undefined, jobIdParameter.metadata);
        if (jobIdParameter.metadata) {
            assert.equal('The id of the Batch job', jobIdParameter.metadata.description);
        }
    });

    test('A job template can be parsed even if it has no parameters', () => {
        const template = <batch.IBatchTemplate>batch.parseBatchTemplate(jobTemplateJsonNoParams, 'job');
        assert.equal(template.parameters.length, 0);
    });

    test('Parsing job template JSON captures default values', () => {
        const template = <batch.IBatchTemplate>batch.parseBatchTemplate(jobTemplateJson, 'job');
        
        const parameter = template.parameters.find((p) => p.name == 'testDefaulted');

        assert.notEqual(undefined, parameter);
        if (parameter) {
            assert.equal('mydef', parameter.defaultValue);
        }
    });

    test('Parsing job template JSON captures allowed values', () => {
        const template = <batch.IBatchTemplate>batch.parseBatchTemplate(jobTemplateJson, 'job');
        
        const parameter = template.parameters.find((p) => p.name == 'testAllowed');

        assert.notEqual(undefined, parameter);
        if (parameter) {
            assert.notEqual(undefined, parameter.allowedValues);
            if (parameter.allowedValues) {
                assert.equal(3, parameter.allowedValues.length);
                assert.equal('alpha', parameter.allowedValues[0]);
            }
        }
    });

    test('Parsing pool template JSON surfaces the parameters', () => {
        const template = <batch.IBatchTemplate>batch.parseBatchTemplate(poolTemplateJson, 'pool');
        assert.equal(template.parameters.length, 1);
        
        assert.equal('vmSize', template.parameters[0].name);
    });
});