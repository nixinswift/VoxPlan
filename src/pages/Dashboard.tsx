import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Plus, FolderKanban, HardHat, Users, Wrench, Trash2, FileDown, BookOpen } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { requireDeletedProject } from "@/lib/projectDeletion";
interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  role: string;
  is_demo?: boolean;
}
const Dashboard = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [metrics, setMetrics] = useState({
    totalTasks: 0,
    totalWorkers: 0,
    equipmentTypes: 0,
    activeDays: 0,
  });
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({
      data: {
        session
      }
    }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (!session) {
        navigate("/auth");
      }
    });
    const {
      data: {
        subscription
      }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);
  useEffect(() => {
    if (user) {
      loadProjects();
      loadMetrics();
    }
  }, [user]);
  const loadProjects = async () => {
    if (!user) return;
    
    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();
    
    const userIsAdmin = !!roleData;
    setIsAdmin(userIsAdmin);
    
    let data, error;
    
    if (userIsAdmin) {
      // Admins see all projects without joining project_members
      const result = await supabase
        .from('projects')
        .select('id, name, description, created_at, is_demo')
        .order('created_at', { ascending: false });
      
      data = result.data;
      error = result.error;
    } else {
      // Regular users only see projects they're members of
      const result = await supabase
        .from('projects')
        .select(`
          id,
          name,
          description,
          created_at,
          is_demo,
          project_members!inner(role)
        `)
        .order('created_at', { ascending: false });
      
      data = result.data;
      error = result.error;
    }
    
    if (error) {
      toast({
        title: "Error loading projects",
        description: error.message,
        variant: "destructive"
      });
      return;
    }
    
    const formattedProjects: Project[] = data.map((project: any) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      created_at: project.created_at,
      role: project.project_members?.[0]?.role || (userIsAdmin ? 'admin' : 'viewer'),
      is_demo: project.is_demo
    }));
    
    setProjects(formattedProjects);
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingProjectId) return;
    setDeletingProjectId(projectId);
    try {
      const { data, error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .select('id');
      if (error) throw error;
      requireDeletedProject(projectId, data);
      setProjects(current => current.filter(project => project.id !== projectId));
      toast({
        title: "Project deleted",
        description: "The project has been deleted successfully."
      });
      await Promise.all([loadProjects(), loadMetrics()]);
    } catch (error) {
      toast({
        title: "Error deleting project",
        description: error instanceof Error ? error.message : "The project could not be deleted. Please reload and try again.",
        variant: "destructive"
      });
    } finally {
      setDeletingProjectId(null);
    }
  };

  const loadMetrics = async () => {
    if (!user) return;

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('manpower, equipment, start_date, duration');

    if (error || !tasks) return;

    const totalWorkers = tasks.reduce((sum, task) => sum + (task.manpower || 0), 0);
    const equipmentSet = new Set(
      tasks
        .map((task) => task.equipment)
        .filter((eq) => eq && eq.trim())
        .flatMap((eq) => eq.split(',').map((e) => e.trim()))
    );

    // Calculate active days span
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    tasks.forEach((task) => {
      const startDate = new Date(task.start_date);
      const endDate = new Date(startDate.getTime() + task.duration * 24 * 60 * 60 * 1000);

      if (!minDate || startDate < minDate) minDate = startDate;
      if (!maxDate || endDate > maxDate) maxDate = endDate;
    });

    const activeDays =
      minDate && maxDate
        ? Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

    setMetrics({
      totalTasks: tasks.length,
      totalWorkers,
      equipmentTypes: equipmentSet.size,
      activeDays,
    });
  };

  const handleCreateProject = async () => {
    if (!user || !newProjectName.trim()) return;
    const {
      error
    } = await supabase.from('projects').insert({
      name: newProjectName.trim(),
      description: newProjectDescription.trim() || null,
      created_by: user.id
    });
    if (error) {
      toast({
        title: "Error creating project",
        description: error.message,
        variant: "destructive"
      });
      return;
    }
    toast({
      title: "Project created",
      description: "Your new project has been created successfully."
    });
    setDialogOpen(false);
    setNewProjectName("");
    setNewProjectDescription("");
    loadProjects();
    loadMetrics();
  };
  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <HardHat className="h-12 w-12 mx-auto text-primary animate-pulse mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>;
  }
  return <div className="flex-1 bg-background">
      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <MetricCard
            title="Total Projects"
            value={projects.length}
            icon={FolderKanban}
            description="Across all locations"
          />
          <MetricCard
            title="Total Tasks"
            value={metrics.totalTasks}
            icon={HardHat}
            description="Scheduled activities"
          />
          <MetricCard
            title="Total Workers"
            value={metrics.totalWorkers}
            icon={Users}
            description="Manpower allocated"
          />
          <MetricCard
            title="Equipment Types"
            value={metrics.equipmentTypes}
            icon={Wrench}
            description="Unique equipment"
          />
        </div>

        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold mb-2">Your Projects</h2>
            <p className="text-muted-foreground">
              Select a project to view and manage its schedule
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>
                  Add a new construction project to manage its schedule
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name</Label>
                  <Input id="name" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="e.g., Main Street Building" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Textarea id="description" value={newProjectDescription} onChange={e => setNewProjectDescription(e.target.value)} placeholder="Brief project description..." rows={3} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateProject} disabled={!newProjectName.trim()}>
                  Create Project
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {projects.length === 0 ? <div className="text-center py-16 border-2 border-dashed border-border rounded-lg">
            <FolderKanban className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">No projects yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first project to start scheduling
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Project
            </Button>
          </div> : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map(project => <Card key={project.id} className="cursor-pointer hover:shadow-lg hover:border-construction-orange/50 transition-all" onClick={() => navigate(`/project/${project.id}`)}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-construction-orange/10 p-2 rounded-lg">
                        <FolderKanban className="h-5 w-5 text-construction-orange" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{project.name}</CardTitle>
                        <span className="text-xs text-muted-foreground capitalize">
                          {project.role}
                        </span>
                      </div>
                    </div>
                    {isAdmin && !project.is_demo && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${project.name}`}
                            disabled={deletingProjectId !== null}
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Project</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{project.name}"? This action cannot be undone and will delete all associated tasks, holidays, and settings.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              disabled={deletingProjectId !== null}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={(e) => handleDeleteProject(project.id, e)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardHeader>
                {project.description && <CardContent>
                    <CardDescription className="line-clamp-2">
                      {project.description}
                    </CardDescription>
                  </CardContent>}
                {project.name === "Practice: Fort McMurray Civil Earthworks" && <CardContent className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                  <Button asChild variant="outline" className="justify-start"><a href="/practice/kyle-civil-drawings.pdf" download><FileDown className="h-4 w-4 mr-2" />Practice drawings</a></Button>
                  <Button asChild variant="outline" className="justify-start"><a href="/practice/kyle-walkthrough.pdf" target="_blank" rel="noopener noreferrer"><BookOpen className="h-4 w-4 mr-2" />Kyle’s walkthrough</a></Button>
                </CardContent>}
              </Card>)}
          </div>}
      </main>
    </div>;
};
export default Dashboard;