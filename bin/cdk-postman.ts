#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkPostmanStack } from '../lib/cdk-postman-stack';

const app = new cdk.App();
new CdkPostmanStack(app, 'CdkPostmanStack');
