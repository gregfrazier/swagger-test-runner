let request = require('request');
let http = require('http');
let Promise = require('bluebird');
let util = require('util');
let fs = require('fs');
let serialTM = require('serialize-to-js').serialize;
let beautify = require('js-beautify').js;

let DefinitionReference = [];

class TestValidationFunction {
    constructor() { }
}

class TestRefObject { 
    constructor(name) {
        this.referenceType = false;
        this.ref = name;
        if(name.items != null && !!(name. items['$ref'])) { 
            this.refName = this.defsKey(name.items['$ref']);
            this.referenceType = true;
        }
        this.stringRep = beautify(serialTM(name));
    }
    serialize() {
        return this.stringRep;
    }
    setStringRepresentation(str) { 
        this.stringRep = str;
    }
    defsKey(ref) {
        const simplify = /#\/definitions\/(.*)/i;
        let match = simplify.exec(ref);
        if(match != null && match.length > 0) 
            return match[1];
        return ref;
    }
}

class TestSinglePayload { 
    constructor(name, type, data) { 
        this.name = name; 
        this.type = type; 
        this.data = data;
    } 
    toString() { 
        return `{ name: "${this.name}", type: "${this.type}", data: ${ typeof(this.data) == "object" ? JSON.stringify(this.data) : '"' + this.data + '"' } }`;
    }
}

class TestExpected { 
    constructor(resp, type) {
        this.response = resp; 
        this.respType = type;
        this.output = null;
    }
}

class TestInstance {
    constructor(name, method, consumes, expected, payload, response, produces) { 
        this.name = name;
        this.method = method;
        this.expected = expected;
        this.payload = payload;
        this.consumes = consumes;
        this.response = response;
        this.produces = produces;
        this.customValidate = (responseData) => { return; };
    }
}

class TestUri {
    constructor(uri, testInstance) {
        this.uri = uri;
        this.testInstance = testInstance;
    }
}

let querySwaggerURL = (url) => {
    return new Promise((resolve, reject) => {
        request(url, (error, response, body) => {
            if(error)
                reject(error);
            else {
                if(response.statusCode == 200) {
                    resolve({ response: response, body: body });
                } else {
                    reject({ response: response, body: body });
                }
            }
        })
    });
};

// get the complex types
let parseSwaggerDefinitions = (dataJSON) => {
    if(dataJSON.definitions != null) {
        let reduceKeys = (obj) => {
            let keys = Object.keys(obj);
            let defs = keys.reduce((p, c) => {
                if(obj.hasOwnProperty(c)) {
                    let prop = obj[c];
                    if(prop.type == "object")
                        p[c] = prop.properties != null ? reduceKeys(prop.properties) : {};
                    else if(prop.type == "array") {
                        let refObject = new TestRefObject(prop);
                        DefinitionReference.push(refObject);
                        p[c] = [ refObject ];
                    }
                    else p[c] = /string/i.test(prop.type) ? "string" : /int/i.test(prop.type) ? 0 : /boolean/i.test(prop.type) ? true : prop.type; 
                } 
                return p;
            }, {});
            return defs;
        }
        return reduceKeys(dataJSON.definitions);
    }
    return {};
};

// Get the paths, generate initial tests 
let parseSwaggerPaths = (dataJSON, tags) => { 
    let swaggerDefs = parseSwaggerDefinitions(dataJSON); 
    let swaggerDefsKey = (ref) => {
        const simplify = /#\/definitions\/(.*)/i; 
        let match = simplify.exec(ref);
        if(match != null && match.length > 0)
            return match[1];
        return ref;
    };

    // Process Reference Definitions, this will only go 5 levels deep
    let reref = [], depth = 0;
    const getRefName = /'\$ref'\:\s*'([^']*)’/i;
    while(reref.length > 0 || depth < 5) {
        reref = [];
        DefinitionReference.forEach((ref) => {
            if(ref.referenceType) {
                let str = !!swaggerDefs[ref.refName].serialize ? 
                    swaggerDefs[ref.refName].serialize() : 
                    beautify(serialTM(swaggerDefs[ref.refName], { reference: false }));
                if(getRefName.test(str)) {
                    let match = getRefName.exec(str);
                    if(match != null && match.length > 0) 
                        reref.push(match[l]);
                }
                ref.setStringRepresentation(str);
            }
        });
        ++depth;
    }

    if(!(tags != null))
        tags = dataJSON.tags.map((o) => {
            return o.name 
        });

    let reducePaths = (obj) => {
        let paths = Object.keys(obj);
        let defs = paths.reduce((p, c) => { 
            let path = obj[c];
            // paths have methods
            let methods = Object.keys(path);
            let payloads = methods.reduce((pr, cr) => { 
                let request = path[cr];

                if(request.tags.some((tag) => { return tags.indexOf(tag) > -1; }) ) {
                    // it's in the specified tags, so use it.
                    let genPayloads = request.parameters.map((param) => {
                        return new TestSinglePayload(param.name,
                            param.in,
                            param.schema != null ?
                            param.schema.$ref != null ? swaggerDefs[swaggerDefsKey(param.schema.$ref)] : param.schema.type : 
                            param.type
                        );
                    });
                    console.log(genPayloads);
                    let responses = Object.keys(request.responses);
                    responses = responses.map((resp) => {
                        let test = new TestInstance(
                            request.operationId,
                            cr.toUpperCase(),
                            request.consumes,
                            new TestExpected(
                                resp,
                                request.responses[resp].schema != null ?
                                    request.responses[resp].schema.$ref != null ? 
                                    swaggerDefs[swaggerDefsKey(request.responses[resp].schema.$ref)] : request.responses[resp].schema.type : 
                                    null
                            ),
                            genPayloads,
                            resp,
                            request.produces
                        ); 
                        return test;
                    });
                    return new TestUri(c, responses);
                }

                return pr;
            }, {});
            if(!!payloads.testInstance)
                p[c] = payloads;
            return p;
        }, {});
        return defs;
    };
    return reducePaths(dataJSON.paths);
};

console.log(`LimpStride - Swagger Doc Test Generator\n`);
if(process.argv.length > 3) {
    let apiDocs = process.argv[2];
    let outputName = process.argv[3];
    console.log(`Connecting to ${apiDocs}`);
    querySwaggerURL(apiDocs).then((response) => {
        let respBody = JSON.parse(response.body);
        if(respBody.swagger != null) {
            console.log(`Swagger version: ${respBody.swagger}`);
            console.log('Building tests from Swagger doc... ');
            let autoTests = parseSwaggerPaths(respBody, ["pet", "store", "user"]);
            let testPath = Object.keys(autoTests);
            let output = testPath.map((name) => { return autoTests[name]; });
            respBody.basePath = respBody.basePath[respBody.basePath.length - 1] = '/' ? respBody.basePath.substr(0, respBody.basePath.length - 2) : respBody.basePath; 
            let outputObject = {
                host: `${respBody.host}${respBody.basePath}`,
                tests: output
            };
            let outputFile = fs.createWriteStream(outputName);
            let structure = "let chai = require('chai');\n\nexports.structure = \n" +
                beautify(serialTM(outputObject, { reference: true })) + ";";
            outputFile.write(structure);
            outputFile.close();
            outputFile.end();
        } else {
            console.log('Swagger JSON not found. Are you sure the URL is correct?');
        }
    }).catch((error) => {
        console.log("Unrecoverable error occurred, details below:");
        console.log(error);
    });
} else {
    console.log("usage: [apidocs uri] [output.js]");
}
