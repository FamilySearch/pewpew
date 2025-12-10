import styles from "./Alert.module.css";
import React from "react";

export const Alert: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.alert} ${className || ""}`} {...props} />
);

export const Success: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.success} ${className || ""}`} {...props} />
);

export const Danger: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.danger} ${className || ""}`} {...props} />
);

export const Warning: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.warning} ${className || ""}`} {...props} />
);

export const Info: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={`${styles.info} ${className || ""}`} {...props} />
);

export default Alert;
