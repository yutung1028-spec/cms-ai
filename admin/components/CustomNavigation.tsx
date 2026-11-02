import {
  DeveloperResourcesMenu,
  NavContainer,
  NavFooter,
  NavItem,
  NavList,
  getHrefFromList,
} from '@keystone-6/core/admin-ui/components'
import type { NavigationProps } from '@keystone-6/core/admin-ui/components'
import { Divider } from '@keystar/ui/layout'
import { NavGroup } from '@keystar/ui/nav-list'

const POI_LIST_KEYS = new Set(['Occupant', 'Amenity'])

export function CustomNavigation({ lists }: NavigationProps) {
  const occupant = lists.find(list => list.key === 'Occupant')
  const amenity = lists.find(list => list.key === 'Amenity')
  const otherLists = lists.filter(list => !POI_LIST_KEYS.has(list.key))

  return (
    <NavContainer>
      <NavList>
        <NavItem href="/">Dashboard</NavItem>
        <Divider />
        <NavGroup title="POIs">
          {occupant && <NavItem href={getHrefFromList(occupant)}>{occupant.label}</NavItem>}
          {amenity && <NavItem href={getHrefFromList(amenity)}>{amenity.label}</NavItem>}
          <NavItem href="/poi-import">POI Import</NavItem>
          <NavItem href="/poi-from-text">從文字建立 POI</NavItem>
          <NavItem href="/accessibility-search">無障礙搜尋助手</NavItem>
        </NavGroup>
        {otherLists.map(list => (
          <NavItem key={list.key} href={getHrefFromList(list)}>
            {list.label}
          </NavItem>
        ))}
      </NavList>
      <NavFooter>
        <DeveloperResourcesMenu />
      </NavFooter>
    </NavContainer>
  )
}
