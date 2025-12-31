#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { AWSAdapterStack } from '../lib/adapter-stack';
import { AWSAdapterCertificateStack } from '../lib/certificate-stack';

const app = new App();
Tags.of(app).add('app', 'sveltekit-adapter-aws-webapp');

const { hostedZone, certificate } = new AWSAdapterCertificateStack(app, process.env.STACKNAME! + '-cert', {
  FQDN: process.env.FQDN!,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1'
  },
  crossRegionReferences: true
});

new AWSAdapterStack(app, process.env.STACKNAME!, {
  FQDN: process.env.FQDN!,
  zoneName: process.env.ZONE_NAME!,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  hostedZone,
  certificate,
  crossRegionReferences: true
});
