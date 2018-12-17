import { join } from 'path';
import { load, send } from './helpers';

interface IAWSLambdaError {
    errorMessage: string;
    errorType: string;
    stackTrace: string[];
}

interface IAWSLambdaContext {
    awsRequestId: string;
    invokedFunctionArn: string;
    logGroupName: string;
    logStreamName: string;
    functionName: string;
    functionVersion: string;
    memoryLimitInMB: string;
    clientContext?: any;
    identity?: any;
    getRemainingTimeInMillis: () => number;
}

const {
  AWS_LAMBDA_FUNCTION_NAME,
  AWS_LAMBDA_FUNCTION_VERSION,
  AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
  AWS_LAMBDA_LOG_GROUP_NAME,
  AWS_LAMBDA_LOG_STREAM_NAME,
  LAMBDA_TASK_ROOT,
  _HANDLER,
  AWS_LAMBDA_RUNTIME_API,
} = process.env

const API_VERSION = '/2018-06-01'

const getNextInvocationUrl = () => `${AWS_LAMBDA_RUNTIME_API}/${API_VERSION}/runtime/invocation/next`;
const getInvocationResponseUrl = (requestId: string) => `${AWS_LAMBDA_RUNTIME_API}/${API_VERSION}/runtime/invocation/${requestId}/response`;
const getInvocationErrorUrl = (requestId: string) => `${AWS_LAMBDA_RUNTIME_API}/${API_VERSION}/runtime/invocation/${requestId}/error`;
const getInitErrorUrl = () => `${AWS_LAMBDA_RUNTIME_API}/${API_VERSION}/runtime/invocation/init/error`;

const createError = (err: Error): IAWSLambdaError => {
    return {
        errorType: err.name,
        errorMessage: err.message,
        stackTrace: (err.stack || '').split('\n')
    };
}

const getLambdaHandler = async (root: string, handler: string) => {
    const [handlerPath, handlerName] = handler.split('.');
    if (!handlerPath || !handlerName) {
        throw new Error(`Invalid handler: ${handler}`);
    }
    const handlerModule = await import(join(root, handlerPath));
    if (!handlerModule) {
        throw new Error('Handler module is empty!');
    }
    if (!handlerModule[handlerName]) {
        throw new Error('Handler function not found!');
    }
    return handlerModule[handlerName];
}

const getNextInvocation = async (): Promise<[unknown, IAWSLambdaContext]> => {
    const data = await load(getNextInvocationUrl());
    const event: unknown = JSON.parse(data.body);

    const deadline = + data.headers['lambda-runtime-deadline-ms']!

    const context: IAWSLambdaContext = {
        awsRequestId: data.headers['lambda-runtime-aws-request-id'] as string,
        invokedFunctionArn: data.headers['lambda-runtime-invoked-function-arn'] as string,
        logGroupName: AWS_LAMBDA_LOG_GROUP_NAME!,
        logStreamName: AWS_LAMBDA_LOG_STREAM_NAME!,
        functionName: AWS_LAMBDA_FUNCTION_NAME!,
        functionVersion: AWS_LAMBDA_FUNCTION_VERSION!,
        memoryLimitInMB: AWS_LAMBDA_FUNCTION_MEMORY_SIZE!,
        getRemainingTimeInMillis: () => deadline - Date.now(),
    }

    if (data.headers['lambda-runtime-client-context']) {
        context.clientContext = JSON.parse(data.headers['lambda-runtime-client-context'] as string)
    }

    if (data.headers['lambda-runtime-cognito-identity']) {
        context.identity = JSON.parse(data.headers['lambda-runtime-cognito-identity'] as string)
    }

    process.env._X_AMZN_TRACE_ID = data.headers['Lambda-Runtime-Trace-Id'] as string;

    return [event, context];
}

const handleInitError = (error: Error) => {
    return send(
        getInitErrorUrl(),
        {},
        JSON.stringify(createError(error))
    );
}

const handleInvocationError = (error: Error, context: IAWSLambdaContext) => {
    return send(
        getInvocationErrorUrl(context.awsRequestId),
        {},
        JSON.stringify(createError(error))
    )
}


const startRuntime = async () => {
    let handler: Function;
    try {
        handler = await getLambdaHandler(LAMBDA_TASK_ROOT!, _HANDLER!);
    } catch (e) {
        handleInitError(e);
        process.exit(1);
        return;
    }
    try {
        while (true) {
            /**
             * 
            Get an event – Call the next invocation API to get the next event. The response body contains the event data. Response headers contain the request ID and other information.
            Propagate the tracing header – Get the X-Ray tracing header from the Lambda-Runtime-Trace-Id header in the API response. Set the _X_AMZN_TRACE_ID environment variable with the same value for the X-Ray SDK to use.
            Create a context object – Create an object with context information from environment variables and headers in the API response.
            Invoke the function handler – Pass the event and context object to the handler.
            Handle the response – Call the invocation response API to post the response from the handler.
            Handle errors – If an error occurs, call the invocation error API.
            Cleanup – Release unused resources, send data to other services, or perform additional tasks before getting the next event.
            */
            const [event, context] = await getNextInvocation();
            let result: any;
            try {
                result = await handler(event, context);
            } catch (e) {
                handleInvocationError(e, context);
                continue;
            }
            await send(
                getInvocationResponseUrl(context.awsRequestId),
                {},
                result
            );
        }
    } catch (e) {
        //Neither init error or invocation error
        console.error(e.message);
        process.exit(1);
    }
};

startRuntime();
