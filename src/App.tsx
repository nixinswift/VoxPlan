import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { VoiceProvider } from "@/contexts/VoiceContext";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import ProjectSchedule from "./pages/ProjectSchedule";
import Estimating from "./pages/Estimating";
import ProjectEstimate from "./pages/ProjectEstimate";
import Auth from "./pages/Auth";
import { ApprovalGuard } from "@/components/ApprovalGuard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <VoiceProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ApprovalGuard />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<Navigate to="/scheduling" replace />} />
            <Route
              path="/scheduling"
              element={
                <AppLayout>
                  <Dashboard />
                </AppLayout>
              }
            />
            <Route
              path="/project/:projectId"
              element={
                <AppLayout>
                  <ProjectSchedule />
                </AppLayout>
              }
            />
            <Route
              path="/estimating"
              element={
                <AppLayout>
                  <Estimating />
                </AppLayout>
              }
            />
            <Route
              path="/estimating/:projectId"
              element={
                <AppLayout>
                  <ProjectEstimate />
                </AppLayout>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </VoiceProvider>
  </QueryClientProvider>
);

export default App;
