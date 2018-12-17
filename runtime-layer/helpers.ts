
import http, { RequestOptions, IncomingMessage, IncomingHttpHeaders } from 'http';
import { parse } from 'url';
import { resolve } from 'path';

export interface IRequestResult {
    statusCode?: number;
    headers: IncomingHttpHeaders;
    body: any;
}

const request = <T = any>(url: string, options: RequestOptions, payload?: T): Promise<any> => {
    return new Promise((resolve, reject) => {
        const req = http.request(Object.assign({}, parse(url), options), (res) => {
            const chunks: any[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString()
                });
            })
        });
        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

export const load = (url: string, options: RequestOptions = {}) => {
    options.method = 'GET';
    return request(url, options);
}

export const send = <T = any>(url: string, options: RequestOptions = {}, payload: T) => {
    options.method = 'POST';
    options.headers = options.headers || {};
    options.headers['Content-Type'] = 'application/json';
    return request<T>(url, options, payload);
}

export const isResponseOk = (response: IRequestResult) => response.statusCode! >= 200 || response.statusCode! <= 300;