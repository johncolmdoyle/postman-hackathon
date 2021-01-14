import * as cdk from '@aws-cdk/core';
import dynamodb = require('@aws-cdk/aws-dynamodb');

export class CdkPostmanGlobalStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Init Table
    const dynamoTable = new dynamodb.Table(this, 'postman-hackathon-init', {
      partitionKey: {
        name: 'initId',
        type: dynamodb.AttributeType.STRING
      },
      tableName: 'postman-hackathon-init',
      billingMode: dynamodb.BillingMode.PROVISIONED,
      replicationRegions: ['us-east-1', 'us-east-2', 'us-west-1'],
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    dynamoTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    }).scaleOnUtilization({ targetUtilizationPercent: 75 });

    // Finish Table
    const finishTable = new dynamodb.Table(this, 'postman-hackathon-finish', {
      partitionKey: { name: 'initId',type: dynamodb.AttributeType.STRING},
      sortKey: { name:"region", type: dynamodb.AttributeType.STRING },
      tableName: 'postman-hackathon-finish',
      billingMode: dynamodb.BillingMode.PROVISIONED,
      replicationRegions: ['us-east-1', 'us-east-2', 'us-west-1'],
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    finishTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    }).scaleOnUtilization({ targetUtilizationPercent: 75 });
  }
}
