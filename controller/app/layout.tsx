import "react-datepicker/dist/react-datepicker.css";
import "../pages/styles.css";

export const metadata = {
  title: "PewPew Load Testing",
  description: "PewPew as a Service (PPaaS) - Load testing platform"
};

export default function RootLayout ({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
