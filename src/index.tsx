import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app";
import { initAuth } from "./services/authStore";
import "./index.css";

// 启动即尝试恢复会话（有 cookie 则拿到登录用户，否则 user=null，不阻塞渲染）
void initAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);