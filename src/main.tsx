import React from "react";
import ReactDOM from "react-dom/client";
import { ReviewProvider } from "./state";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ReviewProvider>
      <App />
    </ReviewProvider>
  </React.StrictMode>,
);
