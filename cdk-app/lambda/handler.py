def lambda_handler(event, context):
    print(f"Received event: {event}")
    return {"message": "Hello from CDK", "input": event}