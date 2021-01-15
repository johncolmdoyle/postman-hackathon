#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkPostmanStack } from '../lib/cdk-postman-stack';
import { CdkPostmanGlobalStack } from '../lib/cdk-postman-global-dynamodb';

const app = new cdk.App();

const globalstack = new CdkPostmanGlobalStack(app, 'CdkPostmanGlobalStack', {env: {region: "us-west-2"}, replicationRegions: ["us-east-1", "us-east-2", "us-west-1"]});

//const east1stack = new CdkPostmanStack(app, 'CdkPostmanEast1Stack', {env: {region: "us-east-1"}});
//const east2stack = new CdkPostmanStack(app, 'CdkPostmanEast2Stack', {env: {region: "us-east-2"}});
//const west1stack = new CdkPostmanStack(app, 'CdkPostmanWest1Stack', {env: {region: "us-west-1"}});

const west2stack = new CdkPostmanStack(app, 'CdkPostmanWest2Stack', {
    env: {region: "us-west-2"}, 
    initGlobalTable: globalstack.initGlobalTable, 
    finishGlobalTable: globalstack.finishGlobalTable});

//east1stack.addDependency(globalstack);
//east2stack.addDependency(globalstack);
//west1stack.addDependency(globalstack);
west2stack.addDependency(globalstack);

cdk.Tags.of(app).add("app", "postman-hackathon");
