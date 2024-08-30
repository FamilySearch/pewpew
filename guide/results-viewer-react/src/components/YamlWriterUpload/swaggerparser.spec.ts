import { expect } from "chai";
import { YamlWriterUpload} from "./index";
import {
    validHarFile
} from "./testData";

import sinon from "sinon";

describe ("YamlWriterUpload", () => {
    describe("submitEvent should handle HAR files", () => {
        it("should parse a valid HAR file", (done: Mocha.Done) => {
            // @ts-ignore
            const yamlWriterUpload: any = new YamlWriterUpload({});

            const mockFileReader = {
                readAsText: sinon.stub(),
                onload: sinon.stub()
            };

            sinon.stub(window, "FileReader").returns(mockFileReader as any);

            yamlWriterUpload.state = { file: validHarFile };

            const toggleCustomizeModalSpy = sinon.spy(yamlWriterUpload, "toggleCustomizeModal");

            mockFileReader.onload.callArgWith(0, {target: { result: JSON.stringify({ log: { entries: [] }}) } });

            yamlWriterUpload.submitEvent()
                .then(() => {
                    expect(toggleCustomizeModalSpy.calledOnce).to.be.true;
                    done();
                })
                .catch(done);

            (window.FileReader as any).restore();
        });
    });
});