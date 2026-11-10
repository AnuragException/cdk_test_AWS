import json

import urllib3

http = urllib3.PoolManager()


def lambda_handler(event, context):
    response = http.request(
        "GET",
        "https://httpbin.org/get",
        timeout=urllib3.Timeout(connect=3.0, read=5.0),
        retries=False,
    )
    body = json.loads(response.data.decode("utf-8"))
    print(f"httpbin status: {response.status}")

    if response.status >= 400:
        raise RuntimeError(f"httpbin returned HTTP {response.status}")

    return {"statusCode": response.status, "body": body}
