import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CdkAppStack } from '../lib/cdk-app-stack';

test('S3 object creation invokes the Lambda function', () => {
  const app = new cdk.App();
  const stack = new CdkAppStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'handler.lambda_handler',
    Runtime: 'python3.12',
  });
  template.hasResourceProperties('Custom::S3BucketNotifications', {
    NotificationConfiguration: Match.objectLike({
      LambdaFunctionConfigurations: Match.arrayWith([
        Match.objectLike({ Events: ['s3:ObjectCreated:*'] }),
      ]),
    }),
  });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    Principal: 's3.amazonaws.com',
  });
});

test('HTTP GET Lambda is defined with the expected runtime and timeout', () => {
  const app = new cdk.App();
  const stack = new CdkAppStack(app, 'HttpbinTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'httpbin-get',
    Handler: 'handler.lambda_handler',
    Runtime: 'python3.12',
    Timeout: 15,
    Layers: Match.anyValue(),
  });
  template.hasResourceProperties('AWS::Lambda::LayerVersion', {
    CompatibleRuntimes: ['python3.12'],
  });
});

test('PostgreSQL reader Lambda uses a layer and has read access to its secret', () => {
  const app = new cdk.App();
  const stack = new CdkAppStack(app, 'PostgresTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'practice-postgres-reader',
    Handler: 'handler.lambda_handler',
    Runtime: 'python3.12',
    Timeout: 15,
    Layers: Match.anyValue(),
    Environment: {
      Variables: Match.objectLike({
        DB_SECRET_ID: 'practice-postgres-credentials',
      }),
    },
  });
  template.hasResourceProperties('AWS::Lambda::LayerVersion', {
    CompatibleRuntimes: ['python3.12'],
    Description: 'psycopg2 dependency for the PostgreSQL reader Lambda',
  });
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
          Effect: 'Allow',
        }),
      ]),
    },
  });
});
