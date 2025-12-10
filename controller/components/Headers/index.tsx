import styles from "./Headers.module.css";
import React from "react";

export const H1: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...props }) => (
  <h1 className={`${styles.h1} ${className || ""}`} {...props} />
);

export const H2: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...props }) => (
  <h2 className={`${styles.h2} ${className || ""}`} {...props} />
);

export const H3: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...props }) => (
  <h3 className={`${styles.h3} ${className || ""}`} {...props} />
);
