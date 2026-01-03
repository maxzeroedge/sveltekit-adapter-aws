/* eslint-disable no-useless-escape */
export const requestFunction = `
function handler(event) {
    const request = event.request;
    const uri = (request.uri || '').split('?')[0];
    console.log(request.uri);
    if(!uri || uri === '/') {
        request.uri += 'index.html';
    } else {
        ['/_app/', '/_data.json', '/style.css', '/favicon.png'].forEach((pathToUse) => {
            if(uri.indexOf(pathToUse) > -1) {
                console.log("subbing...");
                request.uri = uri.substring(uri.indexOf(pathToUse));
            }
        });
        if (!!uri && uri !== '/' && uri.indexOf('api') < 0  && uri.indexOf('callback') < 0 
            && !uri.endsWith('.html') //&& !/\.\w+$/ig.test(uri)
            && uri.indexOf('.') < 0
        ) {
            if (uri.endsWith('/')) {
                request.uri = uri.slice(0, -1); // Remove trailing slash
                //     request.uri += 'index';
            }
            request.uri += '.html';
        }
    }
    console.log("uri: " + uri);

    return request;
}
`;