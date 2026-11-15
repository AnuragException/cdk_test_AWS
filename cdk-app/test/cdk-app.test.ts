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

test('EC2 learning instance has a public VPC and SSM access without inbound rules', () => {
  const app = new cdk.App();
  const stack = new CdkAppStack(app, 'Ec2TestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::EC2::Instance', {
    InstanceType: 't3.micro',
    IamInstanceProfile: Match.anyValue(),
    LaunchTemplate: Match.anyValue(),
    NetworkInterfaces: Match.arrayWith([
      Match.objectLike({ AssociatePublicIpAddress: true }),
    ]),
  });
  template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
    LaunchTemplateData: Match.objectLike({
      MetadataOptions: { HttpTokens: 'required' },
    }),
  });
  template.hasResourceProperties('AWS::EC2::VPC', {
    CidrBlock: '10.0.0.0/16',
    EnableDnsHostnames: true,
    EnableDnsSupport: true,
  });
  template.resourceCountIs('Custom::VpcRestrictDefaultSG', 0);
  template.hasResourceProperties('AWS::EC2::Subnet', {
    CidrBlock: '10.0.0.0/24',
    MapPublicIpOnLaunch: true,
  });
  template.hasResourceProperties('AWS::IAM::Role', {
    ManagedPolicyArns: Match.arrayWith([
      Match.objectLike({
        'Fn::Join': [
          '',
          Match.arrayWith([':iam::aws:policy/AmazonSSMManagedInstanceCore']),
        ],
      }),
    ]),
  });

  const securityGroups = template.findResources('AWS::EC2::SecurityGroup');
  expect(Object.values(securityGroups)).toEqual([
    expect.objectContaining({
      Properties: expect.not.objectContaining({
        SecurityGroupIngress: expect.anything(),
      }),
    }),
  ]);
});

test('EC2 SSH access requires a key pair and a restricted source CIDR', () => {
  const previousKeyPairName = process.env.EC2_SSH_KEY_PAIR_NAME;
  const previousSshCidr = process.env.EC2_SSH_CIDR;
  process.env.EC2_SSH_KEY_PAIR_NAME = 'learning-ec2-key';
  process.env.EC2_SSH_CIDR = '198.51.100.42/32';

  try {
    const app = new cdk.App();
    const stack = new CdkAppStack(app, 'Ec2SshTestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      KeyName: 'learning-ec2-key',
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          CidrIp: '198.51.100.42/32',
          FromPort: 22,
          ToPort: 22,
          IpProtocol: 'tcp',
        }),
      ]),
    });
  } finally {
    if (previousKeyPairName === undefined) {
      delete process.env.EC2_SSH_KEY_PAIR_NAME;
    } else {
      process.env.EC2_SSH_KEY_PAIR_NAME = previousKeyPairName;
    }
    if (previousSshCidr === undefined) {
      delete process.env.EC2_SSH_CIDR;
    } else {
      process.env.EC2_SSH_CIDR = previousSshCidr;
    }
  }
});

test('Weather API EC2 instance reads the DB secret and opens its API port to a CIDR', () => {
  const previousApiCidr = process.env.EC2_API_CIDR;
  process.env.EC2_API_CIDR = '198.51.100.42/32';

  try {
    const app = new cdk.App();
    const stack = new CdkAppStack(app, 'WeatherApiEc2TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::Instance', {
      UserData: Match.anyValue(),
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          CidrIp: '198.51.100.42/32',
          FromPort: 8080,
          ToPort: 8080,
          IpProtocol: 'tcp',
        }),
      ]),
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
  } finally {
    if (previousApiCidr === undefined) {
      delete process.env.EC2_API_CIDR;
    } else {
      process.env.EC2_API_CIDR = previousApiCidr;
    }
  }
});

test('Weather API proxy Lambda forwards requests to its configured backend URL', () => {
  const previousApiUrl = process.env.WEATHER_API_URL;
  process.env.WEATHER_API_URL = 'http://172.17.0.3:8080';

  try {
    const app = new cdk.App();
    const stack = new CdkAppStack(app, 'WeatherProxyTestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'weather-api-proxy',
      Handler: 'handler.lambda_handler',
      Runtime: 'python3.12',
      Timeout: 15,
      Environment: {
        Variables: {
          WEATHER_API_URL: 'http://172.17.0.3:8080',
        },
      },
    });
  } finally {
    if (previousApiUrl === undefined) {
      delete process.env.WEATHER_API_URL;
    } else {
      process.env.WEATHER_API_URL = previousApiUrl;
    }
  }
});
