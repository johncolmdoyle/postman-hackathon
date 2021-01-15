#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkPostmanStack } from '../lib/cdk-postman-stack';
import { CdkPostmanGlobalStack } from '../lib/cdk-postman-global-dynamodb';
import { hackathonConfig } from '../hackathon-config';

const app = new cdk.App();

hackathonConfig.replicationRegions.forEach(function (item, index) {
  const regionstack = new CdkPostmanStack(app, 'Postman-App-'.concat(item), {
    env: {region: item},
    domainName: hackathonConfig.domainName,
    initGlobalTableName: hackathonConfig.globalInitTableName,
    finishGlobalTableName: hackathonConfig.globalFinishTableName,
    lambdaContainerRegions: hackathonConfig.lambdaContainerRegions},);
});

cdk.Tags.of(app).add("app", "postman-hackathon");

