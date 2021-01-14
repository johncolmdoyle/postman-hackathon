import * as cdk from '@aws-cdk/core';
import lambda = require('@aws-cdk/aws-lambda');
import apigateway = require('@aws-cdk/aws-apigateway'); 
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as sqs from '@aws-cdk/aws-sqs';
import { DynamoEventSource, SqsDlq } from '@aws-cdk/aws-lambda-event-sources';

interface CdkPostmanStackProps extends cdk.StackProps {
  readonly initGlobalTable: dynamodb.ITable;
  readonly finishGlobalTable: dynamodb.ITable;
}

export class CdkPostmanStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: CdkPostmanStackProps) {
    super(scope, id, props);

    // DYNAMODB
    const regionTable = new dynamodb.Table(this, "regionTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, 
      partitionKey: { name: "initId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "functionCall", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_IMAGE
    });

    // LAMBDA
    const initiatorLambda = new lambda.Function(this, 'initiatorFunction', {
      code: new lambda.AssetCode('src'),
      handler: 'initiator.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        TABLE_NAME: props.initGlobalTable.tableName,
        PRIMARY_KEY: 'initId'
      }
    });

    const nslookupLambda = new lambda.Function(this, 'nslookupFunction', {
      code: new lambda.AssetCode('src'),
      handler: 'nslookup.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        TABLE_NAME: regionTable.tableName,
        PRIMARY_KEY: 'initId',
        SORT_KEY: 'functionCall'
      }
    });

    const finishedLambda = new lambda.Function(this, 'finishedFunction', {
      code: new lambda.AssetCode('src'),
      handler: 'finished.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        TABLE_NAME: props.finishGlobalTable.tableName,
        PRIMARY_KEY: 'initId',
        SORT_KEY: 'region'
      }
    });

    // LAMBDA PERMISSIONS
    props.initGlobalTable.grantWriteData(initiatorLambda);
    props.initGlobalTable.grantStreamRead(nslookupLambda);
    regionTable.grantWriteData(nslookupLambda);
    props.finishGlobalTable.grantWriteData(finishedLambda);

    // DEADLETTER QUEUE
    const nslookupDeadLetterQueue = new sqs.Queue(this, 'nslookUpDeadLetterQueue');
    const finsihedDeadLetterQueue = new sqs.Queue(this, 'finishedDeadLetterQueue');

    // DYNAMODB TRIGGER
    nslookupLambda.addEventSource(new DynamoEventSource(props.initGlobalTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 5,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(nslookupDeadLetterQueue),
      retryAttempts: 10
    }));

    finishedLambda.addEventSource(new DynamoEventSource(regionTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 5,
      bisectBatchOnError: true,
      onFailure: new SqsDlq(finsihedDeadLetterQueue),
      retryAttempts: 10
    }));

    // API
    const api = new apigateway.RestApi(this, 'networkApi', {
      restApiName: 'Network Service'
    });

    const tests = api.root.addResource('tests');

    const initiatorIntegration = new apigateway.LambdaIntegration(initiatorLambda);
    tests.addMethod('POST', initiatorIntegration);
    addCorsOptions(tests);
  }
}

export function addCorsOptions(apiResource: apigateway.IResource) {
  apiResource.addMethod('OPTIONS', new apigateway.MockIntegration({
    integrationResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Credentials': "'false'",
        'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE'",
      },
    }],
    passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
    requestTemplates: {
      "application/json": "{\"statusCode\": 200}"
    },
  }), {
    methodResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true,
        'method.response.header.Access-Control-Allow-Credentials': true,
        'method.response.header.Access-Control-Allow-Origin': true,
      },  
    }]
  })
}
