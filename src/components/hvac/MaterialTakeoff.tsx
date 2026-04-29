import { useState } from 'react';
import { FileText, DollarSign, Package, Printer, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export default function MaterialTakeoff() {
  const [items, setItems] = useState([
    { id: '1', name: 'Galvanized Steel Duct (24ga)', unit: 'lb', qty: 450, rate: 2.50 },
    { id: '2', name: 'Fiberglass Insulation (1.5")', unit: 'sq ft', qty: 1200, rate: 0.85 },
    { id: '3', name: 'Copper Pipe (Type L, 1")', unit: 'ft', qty: 150, rate: 8.20 },
    { id: '4', name: 'Duct Hangers & Supports', unit: 'set', qty: 45, rate: 12.00 },
    { id: '5', name: 'Diffusers (24x24)', unit: 'ea', qty: 8, rate: 65.00 },
    { id: '6', name: 'Thermostat (Smart)', unit: 'ea', qty: 1, rate: 249.00 },
  ]);

  const subtotal = items.reduce((acc, item) => acc + (item.qty * item.rate), 0);
  const labor = subtotal * 0.45; // 45% labor estimate
  const total = subtotal + labor;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Material Takeoff & Estimation</h2>
          <p className="text-gray-500">Bill of materials and preliminary cost analysis</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2">
            <Printer className="w-4 h-4" /> Print BOM
          </Button>
          <Button className="gap-2 bg-orange-600 hover:bg-orange-700">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="w-5 h-5 text-orange-500" />
              Bill of Materials
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Input 
                        type="number" 
                        value={item.qty} 
                        className="h-8 w-20"
                        onChange={(e) => {
                          const newItems = items.map(i => i.id === item.id ? { ...i, qty: Number(e.target.value) } : i);
                          setItems(newItems);
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-gray-500">{item.unit}</TableCell>
                    <TableCell className="font-mono">${item.rate.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      ${(item.qty * item.rate).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-none shadow-sm bg-gray-900 text-white">
            <CardHeader>
              <CardTitle className="text-gray-400 text-sm font-medium uppercase tracking-wider">Cost Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Materials Subtotal</span>
                <span className="text-xl font-mono">${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Estimated Labor (45%)</span>
                <span className="text-xl font-mono">${labor.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="h-px bg-gray-800" />
              <div className="flex justify-between items-center">
                <span className="text-lg font-bold">Total Estimate</span>
                <span className="text-3xl font-bold text-orange-500 font-mono">
                  ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              
              <Button className="w-full bg-orange-600 hover:bg-orange-700 mt-4 py-6 text-lg">
                Generate Final Quote
              </Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs uppercase text-gray-500">
                    <span>Ductwork</span>
                    <span>42%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500 w-[42%]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs uppercase text-gray-500">
                    <span>Piping</span>
                    <span>28%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 w-[28%]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs uppercase text-gray-500">
                    <span>Equipment</span>
                    <span>30%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 w-[30%]" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
