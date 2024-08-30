// Mock valid and invalid data for testing swagger data

export const validHarFile = new Blob([JSON.stringify({ log: { entries: [] }})], { type: "application/json" });
export const invalidHarFile = new Blob([JSON.stringify({ log: { noEntries: []}})], { type: "application/json" });

export const validHTMLSwaggerFile = new Blob(["<div id=\"swagger-ui\"></div>"], { type: "text/html"});
export const invalidHTMLSwaggerFile = new Blob(["<html></html>"], { type: "text/html" });

export const validSwaggerData = {
    servers: [{ url: "http://example.com"}],
    paths: {},
    openapi: "3.0.0"
};

export const invalidSwaggerData = {
    paths: {}
};