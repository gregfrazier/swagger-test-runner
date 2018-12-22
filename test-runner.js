let request = require('request');
let http = require('http');
let Promise = require('bluebird');
let fs = require('fs');
let chai = require('chai');
let util = require('util');

let testStructure = null;

let processTest = (index, test, host, uri) => {
    let testInstance = test;
    let queryParameters = {};
    let headerParams = {};
    let bodyParam = null;
    let jsonBody = true;

    console.log(`[${index}] Testing ${testInstance.name}... `);

    if(!testInstance.produces)
        testInstance.produces = ['text/plain'];
    headerParams['Accept'] = testInstance.produces.join(",");

    if(!testInstance.payload)
        testInstance.payload = [];
    
    testInstance.payload.forEach((pl) => { 
        if(pl.type.toLowerCase() === "query") 
            queryParameters[pl.name] = pl.data;
        else if(pl.type.toLowerCase() === "body") {
            if(!!pl.dataType && pl.dataType.toLowerCase() === "file") { 
                bodyParam = fs.readFileSync(pl.data).toString(); 
                jsonBody = false;
            } else if(!!pl.dataType && pl.dataType.toLowerCase() === "jsonfile") { 
                bodyParam = JSON.parse(fs.readFileSync(pl.data). toString());
            } else {
                bodyParam = pl.data;
            }
        } else if(pl.type.toLowerCase() === "path") { 
            uri = uri.replace(`{${pl.name}}`, pl.data);
        }
    });
    
    let requestOptions = {
        method: testInstance.method,
        qs: queryParameters, 
        headers: headerParams, 
        uri: `${host}${uri}`, 
        json: jsonBody,
    };
    if(bodyParam != null)
        requestOptions.body = bodyParam;

    console.log(requestOptions)

    let promise = new Promise((resolve, reject) => { 
        request(requestOptions, (error, response, body) => {
            if (error) {
                reject({ index: index, body: error });
            } else {
                try {
                    let data = { index: index, response: response, body: body, testInstance: testInstance }; 
                    chai.expect(response.statusCode).to.equal(parseInt(testInstance.expected.response)); 
                    if(testInstance.customValidate != null && typeof(testInstance.customValidate) === "function") 
                        testInstance.customValidate(data);
                    resolve(data);
                } catch ( ex ) {
                    reject({ index: index, response: response, body: body, testInstance: testInstance, exception: ex });
                }
            }
        })
    });

    return promise;
};

class ExportResults {
    constructor(filename, num) { 
        this.total = num; 
        this.collection = []; 
        this.collected = 0; 
        this.outputName = filename; 
    } 
    addSpec(data, success) {
        this.collection.push({ success: success, data: data });
        if((++this.collected) >= this.total)
            this.exportHTML();
    }
    exportHTML() {
        let succ = this.collection.filter(o => o.success).length;
        let fail = this.collection.length - succ;

        let html = `<html><head><link rel="stylesheet" href="results.css"/></head><body><div class="spec-header">Ran ${this.collection.length} specs</div>\n<div class="spec-results">Success: ${succ} / Failures: ${fail}</div>`;
        let specs = this.collection.sort((a, b) => {
            return parseFloat(a.data.index) - parseFloat(b.data.index);
        }).map((o,i) => {
            if(!!o.data.testInstance)
                return `<div tabindex="${i}" class="result ${o.success ? 'passed' : 'failed'}"><span>[${o.data.index}]</span><span>${o.data.testInstance.name}</span><span class="passfail">[${o.success ? 'Passed' : 'Failed'}]</span></div>` +
                    `<div class="${ !!o.data.exception ? 'extra-results' : 'no-results'}">${ !!o.data.exception ? o.data.exception : '' }<pre>${util.inspect(o.data, { depth: 5 })}</pre></div>`; 
            return '<div class="result failed">Fatal Error</div>';
        }).join('');
        let outputFile = fs.createWriteStream(this.outputName);
        outputFile.write(html + specs + "</body></html>");
        outputFile.close();
        outputFile.end();
        console.log("Exported Results.");
    }
}

console.log(`LimpStride - Swagger Doc Test Runner\n`);
if(process.argv.length > 2) {
    teststructure = require(`./${process.argv[2]}`).structure;

    let len = teststructure.tests.map((o) => { 
        return o.testInstance.length; 
    }).reduce((p,c) => { 
        return p + c; 
    }, 0);
    
    let results = new ExportResults(`${process.argv[2]}.html`, len);
    
    teststructure.tests.forEach((testPath, idx) => {
        testPath.testInstance.forEach((singleTest, num) => {
            let n = `${idx}.${num}`;
            processTest(n, singleTest, teststructure.host, testPath.uri).then((data) => { 
                console.log(`[${data.index}] Successful.`);
                results.addSpec(data, true);
            }).catch((data) => {
                console.log(`[${data.index}] Failure. (${!!data.exception ? data.exception.message : ''})`); 
                results.addSpec(data, false);
            });
        });
    });
} else {
    console.log('usage: [test-input.js]');
}