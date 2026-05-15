import React, { useState, useEffect } from 'react';
import { fetchLocationData } from '../../services/geminiService';
import { Plus, FolderOpen, Building2, MapPin, User as UserIcon, Calendar, Trash2, Search, Loader2, Edit2, ThermometerSun, ThermometerSnowflake } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NumericInput } from '../ui/numeric-input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, query, where, onSnapshot, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { calculatePsychrometrics } from '../../lib/hvac-logic';
import { RegionSelector } from '../RegionSelector';
import { ISCodeAdapter } from '../../lib/is-code-adapter';
import { AutoConfiguredDesignCondition } from '../../lib/regional-design-conditions';

interface Project {
  id: string;
  name: string;
  place: string;
  owner: string;
  typeOfUse: string;
  systemType: 'Hydronic' | 'VRF' | 'Hybrid' | 'Chiller' | 'Others';
  latitude?: number;
  longitude?: number;
  altitude?: number;
  includeMonsoon?: boolean;
  includeWinter?: boolean;
  summerDesignTemp?: number;
  summerDesignHumidity?: number;
  monsoonDesignTemp?: number;
  monsoonDesignHumidity?: number;
  winterDesignTemp?: number;
  winterDesignHumidity?: number;
  summerIndoorTemp?: number;
  summerIndoorHumidity?: number;
  insideSummerTemp?: number;
  insideSummerHumidity?: number;
  insideMonsoonTemp?: number;
  insideMonsoonHumidity?: number;
  winterIndoorTemp?: number;
  winterIndoorHumidity?: number;
  insideWinterTemp?: number;
  insideWinterHumidity?: number;
  designMonth?: number;
  designHour?: number;
  createdAt: any;
  userId: string;
  // IS Code fields
  isCodeCity?: string;
  isCodeStandard?: 'IS_CODE' | 'ASHRAE';
  isCodeLocked?: boolean;
}

export default function ProjectManager({ onSelectProject, userProfile }: { onSelectProject: (project: Project) => void, userProfile: any }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [selectedISCodeRegion, setSelectedISCodeRegion] = useState<AutoConfiguredDesignCondition | null>(null);
  const [selectedISCodeStandard, setSelectedISCodeStandard] = useState<'IS_CODE' | 'ASHRAE'>('ASHRAE');
  const [newProject, setNewProject] = useState({
    name: '',
    place: '',
    owner: '',
    typeOfUse: 'Commercial',
    systemType: 'Hydronic' as 'VRF' | 'Hybrid' | 'Hydronic' | 'Chiller' | 'Others',
    latitude: 0,
    longitude: 0,
    altitude: 0,
    includeMonsoon: false,
    includeWinter: false,
    summerDesignTemp: 95,
    summerDesignHumidity: 50,
    monsoonDesignTemp: 85,
    monsoonDesignHumidity: 85,
    winterDesignTemp: 45,
    winterDesignHumidity: 50,
    summerIndoorTemp: 75,
    summerIndoorHumidity: 50,
    insideSummerTemp: 75,
    insideSummerHumidity: 50,
    insideMonsoonTemp: 75,
    insideMonsoonHumidity: 55,
    winterIndoorTemp: 72,
    winterIndoorHumidity: 40,
    insideWinterTemp: 72,
    insideWinterHumidity: 40,
    designMonth: 7,
    designHour: 15,
    // IS Code regional locking — populated by handleRegionSelect when a city
    // (e.g. Delhi, Mumbai) is chosen via RegionSelector. Defaults to ASHRAE/unlocked.
    isCodeCity: '' as string,
    isCodeStandard: 'ASHRAE' as 'IS_CODE' | 'ASHRAE',
    isCodeLocked: false as boolean,
  });

  useEffect(() => {
    if (editingProject) {
      setNewProject({
        name: editingProject.name,
        place: editingProject.place,
        owner: editingProject.owner,
        typeOfUse: editingProject.typeOfUse,
        systemType: editingProject.systemType,
        latitude: editingProject.latitude || 0,
        longitude: editingProject.longitude || 0,
        altitude: editingProject.altitude || 0,
        includeMonsoon: editingProject.includeMonsoon ?? false,
        includeWinter: editingProject.includeWinter ?? false,
        summerDesignTemp: editingProject.summerDesignTemp || 95,
        summerDesignHumidity: editingProject.summerDesignHumidity || 50,
        monsoonDesignTemp: editingProject.monsoonDesignTemp || 85,
        monsoonDesignHumidity: editingProject.monsoonDesignHumidity || 85,
        winterDesignTemp: editingProject.winterDesignTemp || 45,
        winterDesignHumidity: editingProject.winterDesignHumidity || 50,
        summerIndoorTemp: editingProject.summerIndoorTemp || editingProject.insideSummerTemp || 75,
        summerIndoorHumidity: editingProject.summerIndoorHumidity || editingProject.insideSummerHumidity || 50,
        insideSummerTemp: editingProject.insideSummerTemp || editingProject.summerIndoorTemp || 75,
        insideSummerHumidity: editingProject.insideSummerHumidity || editingProject.summerIndoorHumidity || 50,
        insideMonsoonTemp: editingProject.insideMonsoonTemp || editingProject.summerIndoorTemp || 75,
        insideMonsoonHumidity: editingProject.insideMonsoonHumidity || 55,
        winterIndoorTemp: editingProject.winterIndoorTemp || editingProject.insideWinterTemp || 72,
        winterIndoorHumidity: editingProject.winterIndoorHumidity || editingProject.insideWinterHumidity || 40,
        insideWinterTemp: editingProject.insideWinterTemp || editingProject.winterIndoorTemp || 72,
        insideWinterHumidity: editingProject.insideWinterHumidity || editingProject.winterIndoorHumidity || 40,
        designMonth: editingProject.designMonth || 7,
        designHour: editingProject.designHour || 15,
        isCodeCity: editingProject.isCodeCity ?? '',
        isCodeStandard: editingProject.isCodeStandard ?? 'ASHRAE',
        isCodeLocked: editingProject.isCodeLocked ?? false,
      });
    } else {
      setNewProject({
        name: '',
        place: '',
        owner: '',
        typeOfUse: 'Commercial',
        systemType: 'Hydronic',
        latitude: 0,
        longitude: 0,
        altitude: 0,
        includeMonsoon: false,
        includeWinter: false,
        summerDesignTemp: 95,
        summerDesignHumidity: 50,
        monsoonDesignTemp: 85,
        monsoonDesignHumidity: 85,
        winterDesignTemp: 45,
        winterDesignHumidity: 50,
        summerIndoorTemp: 75,
        summerIndoorHumidity: 50,
        insideSummerTemp: 75,
        insideSummerHumidity: 50,
        insideMonsoonTemp: 75,
        insideMonsoonHumidity: 55,
        winterIndoorTemp: 72,
        winterIndoorHumidity: 40,
        insideWinterTemp: 72,
        insideWinterHumidity: 40,
        designMonth: 7,
        designHour: 15,
        isCodeCity: '',
        isCodeStandard: 'ASHRAE',
        isCodeLocked: false,
      });
    }
  }, [editingProject]);

  useEffect(() => {
    if (!auth.currentUser || !userProfile) return;

    const q = userProfile?.role === 'Super'
      ? query(collection(db, 'projects'))
      : query(
          collection(db, 'projects'),
          where('userId', '==', auth.currentUser.uid),
        );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];
      setProjects(projs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });

    return () => unsubscribe();
  }, [userProfile]);

  useEffect(() => {
    if (userProfile?.role !== 'Super') {
      setOwnerEmails({});
      return;
    }

    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const next: Record<string, string> = {};
      snapshot.docs.forEach((userDoc) => {
        const data: any = userDoc.data();
        if (data?.email) next[userDoc.id] = data.email;
      });
      setOwnerEmails(next);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, [userProfile]);

  const handleCreateProject = async () => {
    if (!newProject.name) {
      toast.error('Project name is required');
      return;
    }

    try {
      const payload = {
        ...newProject,
        includeMonsoon: newProject.includeMonsoon,
        includeWinter: newProject.includeWinter,
        insideSummerTemp: newProject.insideSummerTemp,
        insideSummerHumidity: newProject.insideSummerHumidity,
        insideMonsoonTemp: newProject.insideMonsoonTemp,
        insideMonsoonHumidity: newProject.insideMonsoonHumidity,
        insideWinterTemp: newProject.insideWinterTemp,
        insideWinterHumidity: newProject.insideWinterHumidity,
        // Keep existing legacy fields for compatibility with older paths.
        summerIndoorTemp: newProject.insideSummerTemp,
        summerIndoorHumidity: newProject.insideSummerHumidity,
        winterIndoorTemp: newProject.insideWinterTemp,
        winterIndoorHumidity: newProject.insideWinterHumidity,
        // IS Code fields
        isCodeCity: newProject.isCodeCity,
        isCodeStandard: newProject.isCodeStandard,
        isCodeLocked: newProject.isCodeLocked,
      };

      if (editingProject) {
        await updateDoc(doc(db, 'projects', editingProject.id), {
          ...payload,
        });
        toast.success('Project updated successfully');
      } else {
        await addDoc(collection(db, 'projects'), {
          ...payload,
          userId: auth.currentUser?.uid,
          createdAt: serverTimestamp(),
        });
        toast.success('Project created successfully');
      }
      setIsModalOpen(false);
      setEditingProject(null);
    } catch (error) {
      console.error('Error saving project:', error);
      toast.error('Failed to save project');
    }
  };

  const handleFetchLocationData = async () => {
    if (!newProject.place) {
      toast.error('Please enter a location first');
      return;
    }

    setIsFetching(true);
    try {
      const data = await fetchLocationData(newProject.place);
      if (data) {
        setNewProject(prev => ({
          ...prev,
          latitude: data.latitude,
          longitude: data.longitude,
          altitude: data.altitude,
          summerDesignTemp: data.summerDesignTemp,
          summerDesignHumidity: data.summerDesignHumidity,
          monsoonDesignTemp: data.monsoonDesignTemp ?? prev.monsoonDesignTemp,
          monsoonDesignHumidity: data.monsoonDesignHumidity ?? prev.monsoonDesignHumidity,
          includeMonsoon: data.monsoonDesignTemp != null || data.monsoonDesignHumidity != null ? true : prev.includeMonsoon,
          winterDesignTemp: data.winterDesignTemp,
          winterDesignHumidity: data.winterDesignHumidity
        }));
        toast.success('Location and design data fetched');
      } else {
        toast.error('Could not fetch data for this location. Please try a more specific city name.');
      }
    } catch (error: any) {
      console.error('Error fetching location data:', error);
      const errorMsg = error.message || 'Unknown error';
      toast.error(`Failed to fetch location data: ${errorMsg}`);
      
      if (errorMsg.includes('API Key missing') || errorMsg.includes('Invalid API Key')) {
        toast.info('Tip: Ensure your Gemini API Key is set in the Settings menu.', { duration: 5000 });
      }
    } finally {
      setIsFetching(false);
    }
  };

  const handleISCodeRegionSelect = (config: AutoConfiguredDesignCondition, standard: 'IS_CODE' | 'ASHRAE') => {
    setSelectedISCodeRegion(config);
    setSelectedISCodeStandard(standard);
    
    // Auto-fill design conditions from IS Code
    setNewProject(prev => ({
      ...prev,
      // Summary: India selected → auto-fill IS Code design conditions
      latitude: config.summer.db, // Will be overridden if user fetches location
      place: config.city,
      summerDesignTemp: config.summer.db_f,
      summerDesignHumidity: config.summer.rh,
      monsoonDesignTemp: config.monsoon ? Math.round(config.monsoon.db * 9/5 + 32) : prev.monsoonDesignTemp,
      monsoonDesignHumidity: config.monsoon?.rh ?? prev.monsoonDesignHumidity,
      winterDesignTemp: config.winter ? config.winter.db : prev.winterDesignTemp,
      winterDesignHumidity: config.winter?.rh ?? prev.winterDesignHumidity,
      includeMonsoon: true,
      includeWinter: true,
      // IS Code fields
      isCodeCity: config.city,
      isCodeStandard: standard,
      isCodeLocked: true,
    }));
    
    toast.success(`✓ ${config.city} (IS Code) auto-configured`);
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    
    try {
      await deleteDoc(doc(db, 'projects', id));
      toast.success('Project deleted');
    } catch (error) {
      toast.error('Failed to delete project');
    }
  };

  const handleEditProject = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setEditingProject(project);
    setIsModalOpen(true);
  };

  const canCreate = ['Super', 'Admin A', 'Admin B', 'Design Team'].includes(userProfile?.role);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Project Database</h2>
          <p className="text-gray-500">Manage your HVAC engineering projects</p>
        </div>
        
        {canCreate && (
          <Button
            className="gap-2 bg-orange-600 hover:bg-orange-700"
            onClick={() => { setEditingProject(null); setIsModalOpen(true); }}
          >
            <Plus className="w-4 h-4" /> New Project
          </Button>
        )}
      </div>

      {canCreate && (
        <Dialog open={isModalOpen} onOpenChange={(open) => {
          setIsModalOpen(open);
          if (!open) {
            setEditingProject(null);
            setSelectedISCodeRegion(null);
            setSelectedISCodeStandard('ASHRAE');
          }
        }}>
          <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingProject ? 'Edit Project' : 'Create New Project'}</DialogTitle>
              <DialogDescription>
                {editingProject ? 'Update the details of your building project.' : 'Enter the basic details of the building project.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Project Name</Label>
                <Input 
                  id="name" 
                  placeholder="e.g. Central Plaza HVAC" 
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="place">Place / Location</Label>
                <div className="flex gap-2">
                  <Input 
                    id="place" 
                    placeholder="e.g. New York, NY" 
                    value={newProject.place}
                    onChange={(e) => setNewProject({ ...newProject, place: e.target.value })}
                    className="flex-1"
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="icon" 
                    onClick={handleFetchLocationData}
                    disabled={isFetching}
                    title="Fetch coordinates and design data"
                  >
                    {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              
              {/* IS Code Region Selector - for India projects */}
              <div className="border-t pt-4 bg-yellow-100 p-4 border-2 border-yellow-500">
                <p className="text-sm font-bold text-yellow-900 mb-2">DEBUG: RegionSelector component test</p>
                <RegionSelector 
                  onRegionSelect={handleISCodeRegionSelect}
                  defaultRegion="delhi"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="owner">Owner / Client</Label>
                <Input 
                  id="owner" 
                  placeholder="e.g. Acme Corp" 
                  value={newProject.owner}
                  onChange={(e) => setNewProject({ ...newProject, owner: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">Type of Use</Label>
                  <Select 
                    value={newProject.typeOfUse || ""}
                    onValueChange={(val) => setNewProject({ ...newProject, typeOfUse: val ?? newProject.typeOfUse })}
                  >
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Residential">Residential</SelectItem>
                      <SelectItem value="Commercial">Commercial</SelectItem>
                      <SelectItem value="Industrial">Industrial</SelectItem>
                      <SelectItem value="Hospital">Hospital</SelectItem>
                      <SelectItem value="Data Center">Data Center</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="systemType">System Type</Label>
                  <Select 
                    value={newProject.systemType || ""}
                    onValueChange={(val: any) => setNewProject({ ...newProject, systemType: val })}
                  >
                    <SelectTrigger id="systemType">
                      <SelectValue placeholder="Select system" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Hydronic">Hydronic System</SelectItem>
                      <SelectItem value="VRF">VRF System</SelectItem>
                      <SelectItem value="Hybrid">Hybrid System</SelectItem>
                      <SelectItem value="Chiller">Chiller Plant</SelectItem>
                      <SelectItem value="Others">Others (Split/Package)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="latitude">Latitude</Label>
                  <NumericInput 
                    id="latitude"
                    placeholder="0.0000" 
                    value={newProject.latitude}
                    onChange={(n) => setNewProject({ ...newProject, latitude: n ?? 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="longitude">Longitude</Label>
                  <NumericInput 
                    id="longitude"
                    placeholder="0.0000" 
                    value={newProject.longitude}
                    onChange={(n) => setNewProject({ ...newProject, longitude: n ?? 0 })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="designMonth">Design Month</Label>
                  <Select 
                    value={newProject.designMonth?.toString() || ""}
                    onValueChange={(val) => setNewProject({ ...newProject, designMonth: parseInt(val ?? String(newProject.designMonth)) })}
                  >
                    <SelectTrigger id="designMonth">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                        <SelectItem key={i+1} value={(i+1).toString()}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="designHour">Design Hour (Peak)</Label>
                  <Select 
                    value={newProject.designHour?.toString() || ""}
                    onValueChange={(val) => setNewProject({ ...newProject, designHour: parseInt(val ?? String(newProject.designHour)) })}
                  >
                    <SelectTrigger id="designHour">
                      <SelectValue placeholder="Hour" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }).map((_, i) => (
                        <SelectItem key={i} value={i.toString()}>{i}:00 {i < 12 ? 'AM' : 'PM'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="altitude">Altitude (ft)</Label>
                  <NumericInput 
                    id="altitude"
                    value={newProject.altitude}
                    onChange={(n) => setNewProject({ ...newProject, altitude: n ?? 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="designTemp">Summer Temp (°F)</Label>
                  <NumericInput 
                    id="designTemp"
                    value={newProject.summerDesignTemp}
                    onChange={(n) => setNewProject({ ...newProject, summerDesignTemp: n ?? 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="designHum">Summer RH (%)</Label>
                  <NumericInput 
                    id="designHum"
                    value={newProject.summerDesignHumidity}
                    onChange={(n) => setNewProject({ ...newProject, summerDesignHumidity: n ?? 0 })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2">
                <Label htmlFor="includeWinter" className="font-medium text-blue-700 dark:text-blue-300">Include Winter Heating Calculation</Label>
                <input
                  id="includeWinter"
                  type="checkbox"
                  checked={newProject.includeWinter}
                  onChange={(e) => setNewProject({ ...newProject, includeWinter: e.target.checked })}
                  className="h-4 w-4"
                />
              </div>

              {newProject.includeWinter && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="winterTemp">Winter Temp (°F)</Label>
                    <NumericInput
                      id="winterTemp"
                      value={newProject.winterDesignTemp}
                      onChange={(n) => setNewProject({ ...newProject, winterDesignTemp: n ?? 0 })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="winterHum">Winter RH (%)</Label>
                    <NumericInput
                      id="winterHum"
                      value={newProject.winterDesignHumidity}
                      onChange={(n) => setNewProject({ ...newProject, winterDesignHumidity: n ?? 0 })}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
                <Label htmlFor="includeMonsoon" className="font-medium text-teal-700">Include Monsoon Calculation</Label>
                <input
                  id="includeMonsoon"
                  type="checkbox"
                  checked={newProject.includeMonsoon}
                  onChange={(e) => setNewProject({ ...newProject, includeMonsoon: e.target.checked })}
                  className="h-4 w-4"
                />
              </div>

              {newProject.includeMonsoon && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="monsoonTemp">Monsoon Temp (°F)</Label>
                    <NumericInput
                      id="monsoonTemp"
                      value={newProject.monsoonDesignTemp}
                      onChange={(n) => setNewProject({ ...newProject, monsoonDesignTemp: n ?? 0 })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="monsoonHum">Monsoon RH (%)</Label>
                    <NumericInput
                      id="monsoonHum"
                      value={newProject.monsoonDesignHumidity}
                      onChange={(n) => setNewProject({ ...newProject, monsoonDesignHumidity: n ?? 0 })}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="indoorTemp">Inside Summer Temp (°F)</Label>
                  <NumericInput 
                    id="indoorTemp"
                    value={newProject.insideSummerTemp}
                    onChange={(n) => setNewProject({ ...newProject, insideSummerTemp: n ?? 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="indoorHum">Inside Summer RH (%)</Label>
                  <NumericInput 
                    id="indoorHum"
                    value={newProject.insideSummerHumidity}
                    onChange={(n) => setNewProject({ ...newProject, insideSummerHumidity: n ?? 0 })}
                  />
                </div>
              </div>

              {newProject.includeMonsoon && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="insideMonsoonTemp">Inside Monsoon Temp (°F)</Label>
                    <NumericInput
                      id="insideMonsoonTemp"
                      value={newProject.insideMonsoonTemp}
                      onChange={(n) => setNewProject({ ...newProject, insideMonsoonTemp: n ?? 0 })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="insideMonsoonHum">Inside Monsoon RH (%)</Label>
                    <NumericInput
                      id="insideMonsoonHum"
                      value={newProject.insideMonsoonHumidity}
                      onChange={(n) => setNewProject({ ...newProject, insideMonsoonHumidity: n ?? 0 })}
                    />
                  </div>
                </div>
              )}

              {newProject.includeWinter && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="winterIndoorTemp">Inside Winter Temp (°F)</Label>
                    <NumericInput
                      id="winterIndoorTemp"
                      value={newProject.insideWinterTemp}
                      onChange={(n) => setNewProject({ ...newProject, insideWinterTemp: n ?? 0 })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="winterIndoorHum">Inside Winter RH (%)</Label>
                    <NumericInput
                      id="winterIndoorHum"
                      value={newProject.insideWinterHumidity}
                      onChange={(n) => setNewProject({ ...newProject, insideWinterHumidity: n ?? 0 })}
                    />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsModalOpen(false);
                setEditingProject(null);
                setSelectedISCodeRegion(null);
                setSelectedISCodeStandard('ASHRAE');
              }}>Cancel</Button>
              <Button onClick={handleCreateProject} className="bg-orange-600 hover:bg-orange-700">
                {editingProject ? 'Update Project' : 'Create Project'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.length === 0 ? (
          <div className="col-span-full py-20 text-center border-2 border-dashed rounded-2xl border-gray-200">
            <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
            <p className="text-gray-500">Create your first project to start calculations</p>
          </div>
        ) : (
          projects.map((project) => {
            const summerPsychro = calculatePsychrometrics(
              project.summerDesignTemp || 95,
              project.summerDesignHumidity || 50,
              project.altitude || 0
            );
            const winterPsychro = calculatePsychrometrics(
              project.winterDesignTemp || 45,
              project.winterDesignHumidity || 50,
              project.altitude || 0
            );

            return (
              <Card 
                key={project.id} 
                className="group hover:border-orange-200 hover:shadow-md transition-all cursor-pointer overflow-hidden"
                onClick={() => onSelectProject(project)}
              >
                <CardHeader className="bg-gray-50/50 border-b border-gray-100">
                  <div className="flex justify-between items-start">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      <Building2 className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      {(userProfile?.role === 'Super' || project.userId === auth.currentUser?.uid) && canCreate && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-gray-400 hover:text-orange-600"
                          onClick={(e) => handleEditProject(e, project)}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      )}
                      {(userProfile?.role === 'Super' || project.userId === auth.currentUser?.uid) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-gray-400 hover:text-red-500"
                          onClick={(e) => handleDeleteProject(e, project.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <CardTitle className="mt-4 text-xl">{project.name}</CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                    {project.typeOfUse} • <span className="text-orange-600 font-medium">{project.systemType}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <div className="flex-1">
                      <p>{project.place || 'Location not set'}</p>
                      {project.latitude !== undefined && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {project.latitude.toFixed(4)}°N, {project.longitude?.toFixed(4)}°E • {project.altitude}ft
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-2 bg-orange-50/50 rounded-lg border border-orange-100/50">
                      <div className="flex items-center gap-1.5 mb-1 text-orange-700">
                        <ThermometerSun className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Summer</span>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium">{project.summerDesignTemp}°F / {project.summerDesignHumidity}%</p>
                        <p className="text-[9px] text-gray-500">h: {summerPsychro.enthalpy.toFixed(2)} BTU/lb</p>
                        <p className="text-[9px] text-gray-500">W: {(summerPsychro.humidityRatio * 7000).toFixed(1)} gr/lb</p>
                      </div>
                    </div>
                    <div className="p-2 bg-blue-50/50 rounded-lg border border-blue-100/50">
                      <div className="flex items-center gap-1.5 mb-1 text-blue-700">
                        <ThermometerSnowflake className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Winter</span>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium">{project.winterDesignTemp}°F / {project.winterDesignHumidity}%</p>
                        <p className="text-[9px] text-gray-500">h: {winterPsychro.enthalpy.toFixed(2)} BTU/lb</p>
                        <p className="text-[9px] text-gray-500">W: {(winterPsychro.humidityRatio * 7000).toFixed(1)} gr/lb</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <UserIcon className="w-3.5 h-3.5" />
                      <span>{project.owner || 'Owner'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{project.createdAt?.toDate().toLocaleDateString() || 'Just now'}</span>
                    </div>
                  </div>
                  {userProfile?.role === 'Super' && project.userId && (
                    <div className="pt-2">
                      <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                        Owned by: {ownerEmails[project.userId] || project.userId}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
