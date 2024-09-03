import { YamlWriterUpload } from "../components/YamlWriterUpload";
import { expect } from "chai";
import { render } from "@testing-library/react";

describe("YamlWriterUpload  Tests", () => {
  // Test valid HTML file
  
    it("it should handle valid Swagger HTML file uploads", async () => {
      render(<YamlWriterUpload sendEndpoints={() => {}} />);
      const validDoc = new DOMParser().parseFromString(`
        <div id="swagger-ui">
          <div class="servers">
            <select>
              <option value="http://valid-server.com">http://valid-server.com</option>
            </select>
          </div>
          <div id="operations-default">
            <div class="opblock-summary-path">
              <a>/example/path</a>
            </div>
            <div class="opblock-summary-method">GET</div>
          </div>
        </div>
        <title>Swagger UI</title>
      `, 'text/html');
      const props = { sendEndpoints: () => {} };
      const uploader = YamlWriterUpload(props);

      const result = uploader.isValidHtmlDocument(validDoc);
      expect(result).to.be.true;
    });
});