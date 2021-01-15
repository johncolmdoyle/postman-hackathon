#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkPostmanGlobalStack } from '../lib/cdk-postman-global-dynamodb';
import { hackathonConfig } from '../hackathon-config';

const app = new cdk.App();

const globalstack = new CdkPostmanGlobalStack(
  app,
  'CdkPostmanGlobalStack', {
    env: {region: hackathonConfig.replicationRegions[0]},
    initialTableName: hackathonConfig.globalInitTableName,
    finishTableName: hackathonConfig.globalFinishTableName,
    replicationRegions: hackathonConfig.replicationRegions.slice(1)});

cdk.Tags.of(app).add("app", "postman-hackathon");

