
import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { UserPlus, User as UserIcon, Mail } from 'lucide-react';
import { Calendar, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: 'Super' | 'Admin A' | 'Admin B' | 'Accounts' | 'Technician' | 'Design Team' | 'Pending';
  photoURL?: string;
  createdAt?: any;
  lastLogin?: any;
}

export default function UserManagement({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<string>('Design Team');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

  const currentUserProfile = users.find(u => u.id === currentUser.uid || u.email === currentUser.email);
  const isSuper = currentUserProfile?.role === 'Super';

  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    return () => unsubscribe();
  }, []);

  const updateRole = async (userId: string, role: string) => {
    if (!isSuper) {
      toast.error('Only Super can change user roles.');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', userId), { role });
      toast.success('User role updated');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
    }
  };

  const addUser = async () => {
    if (!isSuper) {
      toast.error('Only Super can whitelist users.');
      return;
    }
    if (!newEmail) return;
    try {
      // We use a temporary ID or the email as ID if we want to whitelist
      // But since we need the UID for firestore rules, we'll actually create a document 
      // that the user will "claim" when they log in. 
      // However, Firestore rules check request.auth.uid. 
      // A better way for whitelisting is to have a "whitelistedEmails" collection.
      // But for simplicity, we'll create a user doc with a placeholder ID and then 
      // the App.tsx logic will handle the UID mapping if the email matches.
      
      // Use the email as the document ID for whitelisting!
      // This makes it easy for the security rules to verify the invite.
      const inviteId = newEmail.toLowerCase().trim();
      await setDoc(doc(db, 'users', inviteId), {
        email: inviteId,
        role: newRole,
        displayName: 'Invited User',
        createdAt: serverTimestamp(),
        isInvited: true
      });
      
      toast.success(`User ${newEmail} whitelisted as ${newRole}`);
      setNewEmail('');
      setIsAddOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const deleteUser = async () => {
    if (!isSuper) {
      toast.error('Only Super can delete users.');
      return;
    }
    if (!userToDelete) return;
    try {
      await deleteDoc(doc(db, 'users', userToDelete.id));
      toast.success('User deleted');
      setUserToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${userToDelete.id}`);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'Super': return <Badge className="bg-purple-600">Super</Badge>;
      case 'Admin A': return <Badge className="bg-blue-600">Procurement</Badge>;
      case 'Admin B': return <Badge className="bg-indigo-600">HR/Tech</Badge>;
      case 'Design Team': return <Badge className="bg-orange-600">Design</Badge>;
      case 'Technician': return <Badge className="bg-green-600">Technician</Badge>;
      case 'Accounts': return <Badge className="bg-slate-600">Accounts</Badge>;
      case 'Pending': return <Badge variant="outline" className="text-red-500 border-red-200">Blocked</Badge>;
      default: return <Badge variant="outline">{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">User Management</h2>
          <p className="text-gray-500">Whitelist employees and manage access permissions.</p>
        </div>
        
        <Button onClick={() => setIsAddOpen(true)} className="gap-2 bg-blue-600 hover:bg-blue-700" style={{ display: isSuper ? undefined : 'none' }}>
          <UserPlus className="w-4 h-4" /> Whitelist New User
        </Button>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Whitelist Employee</DialogTitle>
              <DialogDescription>
                Enter the employee's email to grant them access to the application.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input 
                  id="email" 
                  placeholder="employee@company.com" 
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Assigned Role</Label>
                <Select value={newRole} onValueChange={(val) => setNewRole(val ?? 'Design Team')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Design Team">Design Team (Heat Load)</SelectItem>
                    <SelectItem value="Admin A">Admin A (Procurement)</SelectItem>
                    <SelectItem value="Admin B">Admin B (HR & Technicians)</SelectItem>
                    <SelectItem value="Accounts">Accounts (Billing)</SelectItem>
                    <SelectItem value="Technician">Technician (Site)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button onClick={addUser} disabled={!newEmail}>Add to Whitelist</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete <strong>{userToDelete?.displayName}</strong>? 
                This action cannot be undone and they will lose all access immediately.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setUserToDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={deleteUser}>Delete User</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-blue-50/50 border-blue-100">
          <CardHeader className="py-3">
            <CardTitle className="text-xs font-bold text-blue-700 uppercase">Admin A</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-blue-600">
            Procurement & Equipment Management. Can manage orders and material takeoffs.
          </CardContent>
        </Card>
        <Card className="bg-indigo-50/50 border-indigo-100">
          <CardHeader className="py-3">
            <CardTitle className="text-xs font-bold text-indigo-700 uppercase">Admin B</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-indigo-600">
            HR & Team Management. Can whitelist users and manage technician assignments.
          </CardContent>
        </Card>
        <Card className="bg-orange-50/50 border-orange-100">
          <CardHeader className="py-3">
            <CardTitle className="text-xs font-bold text-orange-700 uppercase">Design Team</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-orange-600">
            Heat Load Calculations. Full access to design projects and systems.
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={`${user.displayName || "User"} avatar`} className="w-8 h-8 rounded-full border" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-8 h-8 rounded-full border bg-slate-100 flex items-center justify-center">
                          <UserIcon className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{user.displayName}</span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {user.email}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getRoleBadge(user.role)}
                      {isSuper && (
                        <Select value={user.role} onValueChange={(val) => { if (val) updateRole(user.id, val); }}>
                          <SelectTrigger className="h-8 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Super">Super</SelectItem>
                            <SelectItem value="Admin A">Admin A (Procurement)</SelectItem>
                            <SelectItem value="Admin B">Admin B (HR/Tech)</SelectItem>
                            <SelectItem value="Accounts">Accounts</SelectItem>
                            <SelectItem value="Technician">Technician</SelectItem>
                            <SelectItem value="Design Team">Design Team</SelectItem>
                            <SelectItem value="Pending">Pending/Blocked</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {user.lastLogin?.toDate ? user.lastLogin.toDate().toLocaleString() : 'Never'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {isSuper && (
                      <Button variant="ghost" size="icon" onClick={() => setUserToDelete(user)} className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
