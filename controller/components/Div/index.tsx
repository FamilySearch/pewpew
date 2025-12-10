import styles from "./Div.module.css";
import React from "react";

export const Div: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.div} ${className || ""}`} {...props} />
);

export const Row: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.row} ${className || ""}`} {...props} />
);

export const Column: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.column} ${className || ""}`} {...props} />
);

/**
 * Left Div (content-align: right)
 */
export const DivLeft: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.divLeft} ${className || ""}`} {...props} />
);

/**
 * Right Div (content-align: left)
 */
export const DivRight: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.divRight} ${className || ""}`} {...props} />
);

export default Div;
