# HVAC Master Pro: Getting Started Guide

Welcome to **HVAC Master Pro**, your professional engineering suite for heat load calculations and system design. This guide will help you and your team get up and running quickly.

---

## 🚀 For Administrators (Super Admin & Admin B)

### 1. Whitelisting Your Team
Before any team member can log in, they must be authorized:
1.  Log in with your administrator account.
2.  Navigate to the **Users** (Shield icon) tab in the sidebar.
3.  Click **Whitelist New User**.
4.  Enter the employee's **Google Email Address**.
5.  Select their specific **Role** (e.g., Design Team, Admin A).
6.  Click **Add to Whitelist**.

### 2. Managing Access
*   **Admin A**: Can manage procurement and equipment lists.
*   **Admin B**: Can manage the team whitelist and technician assignments.
*   **Design Team**: Has full access to engineering calculations and project design.

---

## 📐 For the Design Team

### 1. Creating Your First Project
1.  Go to the **Projects** tab.
2.  Click **Create New Project**.
3.  Enter the project name and location. 
    *   *Tip: Use the "Lookup" button to automatically fetch design temperatures and coordinates via AI.*
4.  Select the **System Type** (Hydronic, VRF, Hybrid, etc.).

### 2. Running Heat Load Calculations
1.  Once a project is active, go to the **Load Calc** tab.
2.  Add **Zones** (e.g., Ground Floor, North Wing).
3.  Add **Rooms** to each zone.
4.  Input room dimensions, orientation, and glass area.
5.  The system will calculate the required Cooling and Heating capacity in real-time.

### 3. Sizing Ducts & Pipes
*   Use the **Duct Sizing** and **Pipe Sizing** tabs for quick engineering calculations based on CFM or GPM requirements.

---

## 📦 For Procurement (Admin A)

### 1. Equipment Selection
1.  Navigate to the **Equipment** tab.
2.  The system will show the required capacities derived from the Design Team's calculations.
3.  Select the appropriate indoor and outdoor units to match the load.

### 2. Material Takeoff
*   View the **Takeoff** tab to see a consolidated list of equipment and materials required for the active project.

---

## 🛠 Technical Requirements & Troubleshooting

### 🔑 Sign-In Process
*   Users must use the **Shared App URL** provided by the Super Admin.
*   Click **Sign in with Google** and use the whitelisted email.
*   On first login, the app will display "Account claimed successfully!"

### ⚠️ Common Issues
*   **403 Forbidden Error**: Ensure your browser is set to **Allow Third-Party Cookies**. This is required for Google's authentication bridge to work.
*   **Access Denied**: Verify that your email has been added to the whitelist in the Users tab.
*   **AI Lookup Not Working**: Ensure the `GEMINI_API_KEY` has been configured in the project secrets.

---

*Need help? Contact your Super Admin or reach out to the engineering support team.*
