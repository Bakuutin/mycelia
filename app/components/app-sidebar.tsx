import * as React from "react"


import { NavMain } from "~/components/nav-main"
import { NavProjects } from "~/components/nav-projects"
import { NavUser } from "~/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "~/components/ui/sidebar"




export function AppSidebar({ data }: { data: any }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* <TeamSwitcher teams={data.teams} /> */}
      </SidebarHeader>
      <SidebarContent>
        {/* <NavMain items={data.navMain} />
        <NavProjects projects={data.projects} /> */}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
