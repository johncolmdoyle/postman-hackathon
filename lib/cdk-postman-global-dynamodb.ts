import * as cdk from '@aws-cdk/core';
import * as dynamodb from '@aws-cdk/aws-dynamodb';

interface CdkPostmanGlobalStackProps extends cdk.StackProps {
  replicationRegions: string[];
}

export class CdkPostmanGlobalStack extends cdk.Stack {
  public readonly initGlobalTable: dynamodb.ITable;
  public readonly finishGlobalTable: dynamodb.ITable;

  constructor(scope: cdk.Construct, id: string, props: CdkPostmanGlobalStackProps) {
    super(scope, id, props);

    // Init Table
    const initTable = new dynamodb.Table(this, 'postman-hackathon-init', {
      partitionKey: {
        name: 'initId',
        type: dynamodb.AttributeType.STRING
      },
      tableName: 'postman-hackathon-init',
      billingMode: dynamodb.BillingMode.PROVISIONED,
      replicationRegions: props.replicationRegions,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    initTable.autoScaleWriteCapacity({
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

    // Exports
    this.initGlobalTable = initTable;
    this.finishGlobalTable = finishTable;
  }
}
