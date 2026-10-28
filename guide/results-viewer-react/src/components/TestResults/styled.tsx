import styled from "styled-components";

/**
 * Sized box that Chart.js fills. Chart.js reads its size from the canvas's parent, so the parent
 * must be a dedicated block with a fixed height. Forcing the canvas size with CSS instead makes the
 * backing store and the CSS size disagree and squashes everything drawn, tooltips included.
 */
export const ChartBox = styled.div`
  position: relative;
  width: 100%;
  height: 270px;
`;
