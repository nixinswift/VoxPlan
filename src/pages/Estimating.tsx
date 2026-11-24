import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Calculator, FolderKanban, HardHat } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  estimateCount?: number;
}

const Estimating = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (!session) navigate("/auth");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) navigate("/auth");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (user) loadProjects();
  }, [user]);

  const loadProjects = async () => {
    if (!user) return;

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    const isAdmin = !!roleData;

    let data, error;
    if (isAdmin) {
      const result = await supabase.from("projects").select("id, name, description, created_at").order("created_at", { ascending: false });
      data = result.data;
      error = result.error;
    } else {
      const result = await supabase.from("projects").select("id, name, description, created_at, project_members!inner(role)").order("created_at", { ascending: false });
      data = result.data;
      error = result.error;
    }

    if (error) {
      toast({ title: "Error loading projects", description: error.message, variant: "destructive" });
      return;
    }

    // Get estimate counts per project
    const { data: estimates } = await supabase.from("estimates").select("project_id");

    const countMap: Record<string, number> = {};
    estimates?.forEach((e: any) => {
      countMap[e.project_id] = (countMap[e.project_id] || 0) + 1;
    });

    const formatted: Project[] = (data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      created_at: p.created_at,
      estimateCount: countMap[p.id] || 0,
    }));

    setProjects(formatted);
  };

  const totalEstimates = projects.reduce((s, p) => s + (p.estimateCount || 0), 0);
  const projectsWithEstimates = projects.filter((p) => (p.estimateCount || 0) > 0).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <HardHat className="h-12 w-12 mx-auto text-primary animate-pulse mb-4" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <header className="border-b border-border bg-steel-dark px-4 sm:px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="bg-construction-orange text-primary-foreground p-2 rounded-lg">
            <Calculator className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Concrete Estimating</h1>
            <p className="text-sm text-white/70">Select a project to manage its estimates</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <MetricCard title="Total Projects" value={projects.length} icon={FolderKanban} description="Available for estimating" />
          <MetricCard title="Projects with Estimates" value={projectsWithEstimates} icon={Calculator} description="Have estimate items" />
          <MetricCard title="Total Estimate Items" value={totalEstimates} icon={Calculator} description="Across all projects" />
        </div>

        <div className="mb-6">
          <h2 className="text-2xl font-semibold mb-2">Your Projects</h2>
          <p className="text-muted-foreground">Select a project to add or view concrete estimates</p>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-border rounded-lg">
            <FolderKanban className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">No projects yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create a project in Scheduling first, then come back to add estimates.</p>
            <Button onClick={() => navigate("/scheduling")}>Go to Scheduling</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer hover:shadow-lg hover:border-construction-orange/50 transition-all"
                onClick={() => navigate(`/estimating/${project.id}`)}
              >
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="bg-construction-orange/10 p-2 rounded-lg">
                      <Calculator className="h-5 w-5 text-construction-orange" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{project.name}</CardTitle>
                      <span className="text-xs text-muted-foreground">
                        {project.estimateCount || 0} estimate items
                      </span>
                    </div>
                  </div>
                </CardHeader>
                {project.description && (
                  <CardContent>
                    <CardDescription className="line-clamp-2">{project.description}</CardDescription>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Estimating;
