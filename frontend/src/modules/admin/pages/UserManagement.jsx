import React, { useState, useEffect } from 'react';
import Card from '@shared/components/ui/Card';
import Button from '@shared/components/ui/Button';
import Badge from '@shared/components/ui/Badge';
import { HiOutlineUserAdd } from 'react-icons/hi';
import { adminApi } from '../services/adminApi';
import { toast } from 'sonner';

const UserManagement = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const response = await adminApi.getUsers();
                if (response.data.success) {
                    setUsers(response.data.result.items);
                }
            } catch (error) {
                toast.error("Failed to load users");
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        fetchUsers();
    }, []);

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="ds-h1">Platform Users</h2>
                <Button>
                    <HiOutlineUserAdd className="mr-2 h-5 w-5" />
                    Add Internal User
                </Button>
            </div>

            <Card>
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="p-8 text-center text-gray-500 font-semibold">Loading users...</div>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="ds-table-header-cell">User</th>
                                    <th className="ds-table-header-cell">Role</th>
                                    <th className="ds-table-header-cell">Status</th>
                                    <th className="ds-table-header-cell">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {users.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-8 text-center text-gray-500 font-medium">No users found</td>
                                    </tr>
                                ) : users.map((user) => (
                                    <tr key={user.id}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center">
                                                <img 
                                                    src={user.avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
                                                    alt={user.name} 
                                                    className="h-9 w-9 rounded-full bg-slate-50 ring-1 ring-slate-100 object-cover mr-3" 
                                                />
                                                <div>
                                                    <p className="font-semibold text-gray-900 text-sm">{user.name}</p>
                                                    <p className="text-xs text-gray-500">{user.email || user.phone}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600 uppercase">CUSTOMER</td>
                                        <td className="px-6 py-4">
                                            <Badge variant={user.status === 'active' ? 'success' : 'error'} className="uppercase">
                                                {user.status}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4">
                                            <button className="text-primary-600 hover:text-primary-700 text-sm font-medium">Manage</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default UserManagement;
