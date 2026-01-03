import { Construct } from 'constructs';
import {
  StackProps,
  Stack,
  Fn,
  RemovalPolicy,
  Duration,
  CfnOutput,
  aws_lambda,
  aws_s3,
  aws_s3_deployment,
  aws_cloudfront_origins,
  aws_certificatemanager,
  aws_route53,
  aws_route53_targets,
  aws_cloudfront,
  aws_iam,
} from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, IHttpApi, PayloadFormatVersion } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { config } from 'dotenv';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { requestFunction } from './functions';

export interface AWSAdapterStackProps extends StackProps {
  FQDN: string;
  account?: string;
  region?: string;
  serverHandlerPolicies?: PolicyStatement[];
  zoneName?: string;
  uiBucketName?: string;
  certificate: aws_certificatemanager.ICertificate;
  hostedZone: aws_route53.IHostedZone;
  defaultStaticBehaviour?: boolean;
  requestFunctionCode?: string;
  responseFunctionCode?: string;
}

export class AWSAdapterStack extends Stack {
  bucket: aws_s3.IBucket;
  serverHandler: aws_lambda.IFunction;
  httpApi: IHttpApi;

  constructor(scope: Construct, id: string, props: AWSAdapterStackProps) {
    super(scope, id, props);

    const routes = process.env.ROUTES?.split(',') || [];
    const apiRoutes = process.env.API_ROUTES?.split(',') || [];
    const projectPath = process.env.PROJECT_PATH;
    const serverPath = process.env.SERVER_PATH;
    const staticPath = process.env.STATIC_PATH;
    const prerenderedPath = process.env.PRERENDERED_PATH;
    const logRetention = parseInt(process.env.LOG_RETENTION_DAYS!) || 7;
    const memorySize = parseInt(process.env.MEMORY_SIZE!) || 128;
    const environment = config({ path: projectPath });
    const FQDN = props.FQDN || process.env.FQDN;

    this.serverHandler = new aws_lambda.Function(this, 'LambdaServerFunctionHandler', {
      code: new aws_lambda.AssetCode(serverPath!),
      handler: 'index.handler',
      runtime: aws_lambda.Runtime.NODEJS_22_X,
      timeout: Duration.minutes(15),
      memorySize,
      logRetention,
      environment: {
        ...environment.parsed,
      } as any,
    });

    props.serverHandlerPolicies?.forEach((policy) => this.serverHandler.addToRolePolicy(policy));

    this.httpApi = new HttpApi(this, 'API', {
      apiName: id + 'API',
      corsPreflight: {
        allowHeaders: ['*'],
        allowMethods: [CorsHttpMethod.ANY],
        allowOrigins: ['*'],
        maxAge: Duration.days(1),
      },
      defaultIntegration: new HttpLambdaIntegration('LambdaServerIntegration', this.serverHandler, {
        payloadFormatVersion: PayloadFormatVersion.VERSION_1_0,
      }),
    });

    if (props.uiBucketName) {
      this.bucket = aws_s3.Bucket.fromBucketName(this, 'StaticContentBucket', props.uiBucketName);
    } else {
      this.bucket = new aws_s3.Bucket(this, 'StaticContentBucket', {
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        // websiteIndexDocument: 'index.html',
      });
    }

    const httpOrigin = new aws_cloudfront_origins.HttpOrigin(Fn.select(1, Fn.split('://', this.httpApi.apiEndpoint)), {
      protocolPolicy: aws_cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    const httpOriginBehaviour: aws_cloudfront.AddBehaviorOptions = {
      compress: true,
      viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: aws_cloudfront.AllowedMethods.ALLOW_ALL,
      originRequestPolicy: new aws_cloudfront.OriginRequestPolicy(this, 'OriginRequestPolicy', {
        cookieBehavior: aws_cloudfront.OriginRequestCookieBehavior.all(),
        queryStringBehavior: aws_cloudfront.OriginRequestQueryStringBehavior.all(),
        headerBehavior: aws_cloudfront.OriginRequestHeaderBehavior.allowList(
          'Origin',
          'Accept-Charset',
          'Accept',
          'Access-Control-Request-Method',
          'Access-Control-Request-Headers',
          'Referer',
          'Accept-Language',
          'Accept-Datetime'
        ),
      }),
      cachePolicy: aws_cloudfront.CachePolicy.CACHING_DISABLED,
    };

    const s3Origin = aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(this.bucket);
    let s3OriginBehaviour: aws_cloudfront.AddBehaviorOptions = {
      compress: true,
      viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      originRequestPolicy: aws_cloudfront.OriginRequestPolicy.USER_AGENT_REFERER_HEADERS,
      cachePolicy: aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
    };

    // Add Cloudfront Functions if needed
    let functionAssociations: aws_cloudfront.FunctionAssociation[]  = [];
    [
      [ props.requestFunctionCode, 'RequestFunction', aws_cloudfront.FunctionEventType.VIEWER_REQUEST ],
      [ props.responseFunctionCode, 'ResponseFunction', aws_cloudfront.FunctionEventType.VIEWER_RESPONSE ]
    ].forEach((v) => {
      if(props.defaultStaticBehaviour && v[1] === 'RequestFunction' && !v[0]) {
        v[0] = requestFunction;
      }
      if(v[0]) {
        const cloudfrontFunction = new aws_cloudfront.Function(this, 'S3' + v[1], {
          code: aws_cloudfront.FunctionCode.fromInline(v[0]),
          functionName: id + v[1],
          runtime: aws_cloudfront.FunctionRuntime.JS_2_0
        });
        functionAssociations.push(
          {
            eventType: v[2] as aws_cloudfront.FunctionEventType,
            function: cloudfrontFunction,
          }
        );
      }
    })
    if (functionAssociations.length) {
      s3OriginBehaviour = {
        ...s3OriginBehaviour,
        functionAssociations
      }
    }

    const domainNames = FQDN ? [FQDN] : [];
    if (FQDN?.startsWith('www.')) {
      domainNames.push(FQDN.substring(4));
    }

    const distribution = new aws_cloudfront.Distribution(this, 'CloudFrontDistribution', {
      priceClass: aws_cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
      defaultRootObject: props.defaultStaticBehaviour ? 'index.html' : '',
      sslSupportMethod: aws_cloudfront.SSLMethod.SNI,
      domainNames: FQDN ? [FQDN!] : [],
      certificate: FQDN
        ? aws_certificatemanager.Certificate.fromCertificateArn(
            this,
            'DomainCertificate',
            props.certificate.certificateArn
          )
        : undefined,
      defaultBehavior: props.defaultStaticBehaviour ? {
        origin: s3Origin,
        ...s3OriginBehaviour
      } : {
        origin: httpOrigin,
        ...httpOriginBehaviour
      },
    });

    this.bucket.addToResourcePolicy(
      new PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        principals: [new aws_iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [`${this.bucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      })
    );

    routes.forEach((route) => {
      distribution.addBehavior(route, s3Origin, s3OriginBehaviour);
    });
    apiRoutes.forEach((route) => {
      distribution.addBehavior(route, httpOrigin, httpOriginBehaviour);
    });

    if (FQDN) {
      new aws_route53.ARecord(this, 'ARecord', {
        recordName: FQDN,
        target: aws_route53.RecordTarget.fromAlias(new aws_route53_targets.CloudFrontTarget(distribution)),
        zone: props.hostedZone,
      });
      if (FQDN.startsWith('www.')){
        new aws_route53.ARecord(this, 'ARecordNoWWW', {
          recordName: FQDN.substring(4),
          target: aws_route53.RecordTarget.fromAlias(new aws_route53_targets.CloudFrontTarget(distribution)),
          zone: props.hostedZone,
        });
      }
    }

    new aws_s3_deployment.BucketDeployment(this, 'StaticContentDeployment', {
      destinationBucket: this.bucket,
      sources: [aws_s3_deployment.Source.asset(staticPath!), aws_s3_deployment.Source.asset(prerenderedPath!)],
      retainOnDelete: false,
      prune: true,
      distribution,
      distributionPaths: ['/*'],
    });

    new CfnOutput(this, 'appUrl', {
      value: FQDN ? `https://${FQDN}` : `https://${distribution.domainName}`,
    });

    new CfnOutput(this, 'stackName', { value: id });
  }
}
