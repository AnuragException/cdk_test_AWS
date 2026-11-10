import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaDestinations from 'aws-cdk-lib/aws-s3-notifications';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export class CdkAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'LearningBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new lambda.Function(this, 'HelloFunction', {
      functionName: 'cdk-s3-event-handler',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
    });

    const urllib3Layer = new lambda.LayerVersion(this, 'Urllib3Layer', {
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'urllib3 dependency for the httpbin Lambda',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/urllib3-layer'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash',
            '-c',
            'mkdir -p /asset-output/python && pip install -r requirements.txt -t /asset-output/python',
          ],
        },
      }),
    });

    const httpbinFunction = new lambda.Function(this, 'HttpbinFunction', {
      functionName: 'httpbin-get',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/httpbin')),
      layers: [urllib3Layer],
      timeout: cdk.Duration.seconds(15),
    });

    bucket.grantReadWrite(fn);
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new lambdaDestinations.LambdaDestination(fn),
    );

    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'FunctionName', { value: fn.functionName });
    new cdk.CfnOutput(this, 'HttpbinFunctionName', { value: httpbinFunction.functionName });
  }
}